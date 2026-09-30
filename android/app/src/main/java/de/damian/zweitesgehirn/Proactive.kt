package de.damian.zweitesgehirn

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * Jarvis meldet sich von selbst (jeden Morgen um 7:30), auch wenn die App zu ist:
 * Geburtstage, bald anstehende Arbeiten in der Schule und Budget-Warnungen.
 * Die Web-App schickt dafür eine kleine Übersicht (sync), das Handy prüft sie dann täglich.
 */
object Proactive {
    private fun p(ctx: Context) = ctx.getSharedPreferences("zg_proactive", Context.MODE_PRIVATE)

    fun sync(ctx: Context, json: String) {
        val j = try { JSONObject(json) } catch (_: Throwable) { return }
        p(ctx).edit().putString("snap", j.toString()).apply()
        arm(ctx)
    }
    private fun snap(ctx: Context): JSONObject = try { JSONObject(p(ctx).getString("snap", "{}") ?: "{}") } catch (_: Throwable) { JSONObject() }
    fun enabled(ctx: Context) = snap(ctx).optBoolean("on", true)

    private fun pending(ctx: Context, evening: Boolean = false) = PendingIntent.getBroadcast(ctx, if (evening) 7310 else 7300,
        Intent(ctx, ProactiveReceiver::class.java).putExtra("slot", if (evening) "evening" else "morning"),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    fun arm(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        am.cancel(pending(ctx)); am.cancel(pending(ctx, true))
        if (!enabled(ctx)) return
        val s = snap(ctx)
        fun at(h: Int, m: Int) = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, h); set(Calendar.MINUTE, m); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            if (timeInMillis <= System.currentTimeMillis() + 5000) add(Calendar.DAY_OF_YEAR, 1)
        }.timeInMillis
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at(s.optInt("h", 7), s.optInt("m", 30)), pending(ctx))
        // Abends (19 Uhr): Müll, Stundenplan-Änderungen für morgen, Berichtsheft
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at(s.optInt("eh", 19), s.optInt("em", 0)), pending(ctx, true))
    }

    private fun key(c: Calendar) = "%04d-%02d-%02d".format(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))

    /** Abend-Hinweise (für morgen) */
    fun eveningLines(ctx: Context, now: Calendar = Calendar.getInstance()): List<String> {
        val s = snap(ctx); val out = ArrayList<String>()
        val tomorrow = (now.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, 1) }
        // Müllabfuhr morgen
        val mu = s.optJSONArray("muell") ?: JSONArray()
        val bins = (0 until mu.length()).mapNotNull { mu.optJSONObject(it) }.filter { it.optString("d") == key(tomorrow) }.map { it.optString("t") }
        if (bins.isNotEmpty()) out += "🗑 Morgen wird abgeholt: ${bins.joinToString(", ")} – heute Abend rausstellen!"
        // Stundenplan morgen (Ausfälle/Vertretungen)
        try { out += Untis.changes(ctx, 1) } catch (_: Throwable) {}
        // Berichtsheft (Mo–Fr)
        val b = s.optJSONObject("bericht")
        val wd = now.get(Calendar.DAY_OF_WEEK)
        if (b != null && b.optBoolean("on", true) && wd in Calendar.MONDAY..Calendar.FRIDAY) {
            val days = b.optJSONArray("days") ?: JSONArray()
            val has = (0 until days.length()).any { days.optString(it) == key(now) }
            if (!has) out += "📒 Berichtsheft: Was hast du heute gemacht? Sag „Berichtsheft: …“"
            if (wd == Calendar.FRIDAY) out += "📒 Wochenende! Sag „Mach meinen Wochenbericht“, dann ist das Berichtsheft fertig."
        }
        return out
    }

    /** Welche Hinweise gibt es heute? (auch für Tests/Anzeige nutzbar) */
    fun lines(ctx: Context, now: Calendar = Calendar.getInstance()): List<String> {
        val s = snap(ctx); val out = ArrayList<String>()
        // Stundenplan heute (kurzfristige Änderungen)
        try { out += Untis.changes(ctx, 0) } catch (_: Throwable) {}
        // Prüfungs-Trainer: fällige Karteikarten
        val pd = s.optInt("ptDue", 0)
        if (pd > 0) out += "🎓 $pd Karteikarte${if (pd == 1) "" else "n"} fällig – 10 Minuten reichen. Sag „Öffne den Prüfungs-Trainer“."
        // Lernplan: bis zur nächsten Arbeit jeden Tag ein Thema
        val st = s.optJSONArray("study") ?: JSONArray()
        for (i in 0 until st.length()) {
            val x = st.optJSONObject(i) ?: continue
            val topic = x.optJSONObject("plan")?.optString(key(now)).orEmpty()
            if (topic.isNotBlank()) out += "📚 Lernplan ${x.optString("subject")} (noch ${x.optInt("left")} Tage → heute: $topic). Sag „Frag mich ${x.optString("subject")} ab“."
        }
        val today = now.clone() as Calendar
        fun dayOffset(k: Int) = (today.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, k) }
        // Geburtstage heute / morgen
        val bs = s.optJSONArray("birthdays") ?: JSONArray()
        for (i in 0 until bs.length()) {
            val b = bs.optJSONObject(i) ?: continue
            for (k in 0..1) {
                val d = dayOffset(k)
                if (d.get(Calendar.DAY_OF_MONTH) == b.optInt("d") && d.get(Calendar.MONTH) + 1 == b.optInt("m"))
                    out += "🎂 ${b.optString("name")} hat ${if (k == 0) "heute" else "morgen"} Geburtstag"
            }
        }
        // Arbeiten in der Schule: heute, morgen, in 3 Tagen
        val ex = s.optJSONArray("exams") ?: JSONArray()
        for (i in 0 until ex.length()) {
            val x = ex.optJSONObject(i) ?: continue
            for (k in listOf(0, 1, 3)) {
                val d = dayOffset(k)
                val key = "%04d-%02d-%02d".format(d.get(Calendar.YEAR), d.get(Calendar.MONTH) + 1, d.get(Calendar.DAY_OF_MONTH))
                if (x.optString("date") == key) {
                    val what = x.optString("kind", "Arbeit") + (if (x.optString("subject").isNotBlank()) " in ${x.optString("subject")}" else "")
                    out += "📝 $what " + when (k) { 0 -> "ist heute – viel Erfolg!"; 1 -> "ist morgen. Sag „Frag mich ab“ zum Üben."; else -> "ist in 3 Tagen." }
                }
            }
        }
        // Budget-Warnungen (von der App berechnet), nur im selben Monat und nur einmal pro Text
        val month = "%04d-%02d".format(now.get(Calendar.YEAR), now.get(Calendar.MONTH) + 1)
        val bw = s.optJSONObject("budget")
        if (bw != null && bw.optString("month") == month) {
            val seen = p(ctx).getStringSet("seen_budget", emptySet()) ?: emptySet()
            val warns = bw.optJSONArray("warns") ?: JSONArray()
            val fresh = (0 until warns.length()).map { warns.optString(it) }.filter { it.isNotBlank() && "$month|$it" !in seen }
            fresh.forEach { out += "⚠ $it" }
            if (fresh.isNotEmpty()) p(ctx).edit().putStringSet("seen_budget", (seen.filter { it.startsWith(month) } + fresh.map { "$month|$it" }).toSet()).apply()
        }
        return out
    }

    fun fire(ctx: Context, evening: Boolean = false) {
        if (!enabled(ctx)) return
        try {
            if (evening) {
                val l = eveningLines(ctx)
                if (l.isNotEmpty()) Notes.show(ctx, "proactive", "Hinweise von Jarvis", 7302,
                    if (l.size == 1) "Hinweis für morgen" else "Jarvis: ${l.size} Hinweise für morgen", l.joinToString("\n"))
            } else {
                val l = lines(ctx)
                if (l.isNotEmpty()) Notes.show(ctx, "proactive", "Hinweise von Jarvis", 7301,
                    if (l.size == 1) "Hinweis von Jarvis" else "Jarvis: ${l.size} Hinweise für heute", l.joinToString("\n"))
            }
        } finally { arm(ctx) }
    }
}

class ProactiveReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == "android.intent.action.QUICKBOOT_POWERON") { Proactive.arm(ctx); return }
        val evening = intent.getStringExtra("slot") == "evening"
        val r = goAsync()   // Untis braucht Internet: im Hintergrund-Thread
        Thread { try { Proactive.fire(ctx, evening) } catch (_: Throwable) {} finally { r.finish() } }.start()
    }
}
