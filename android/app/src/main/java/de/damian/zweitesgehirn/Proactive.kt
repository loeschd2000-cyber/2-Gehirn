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

    private fun pending(ctx: Context) = PendingIntent.getBroadcast(ctx, 7300, Intent(ctx, ProactiveReceiver::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    fun arm(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        am.cancel(pending(ctx))
        if (!enabled(ctx)) return
        val s = snap(ctx)
        val c = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, s.optInt("h", 7)); set(Calendar.MINUTE, s.optInt("m", 30)); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            if (timeInMillis <= System.currentTimeMillis() + 5000) add(Calendar.DAY_OF_YEAR, 1)
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, c.timeInMillis, pending(ctx))
    }

    /** Welche Hinweise gibt es heute? (auch für Tests/Anzeige nutzbar) */
    fun lines(ctx: Context, now: Calendar = Calendar.getInstance()): List<String> {
        val s = snap(ctx); val out = ArrayList<String>()
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

    fun fire(ctx: Context) {
        if (!enabled(ctx)) return
        val l = lines(ctx)
        if (l.isNotEmpty()) Notes.show(ctx, "proactive", "Hinweise von Jarvis", 7301,
            if (l.size == 1) "Hinweis von Jarvis" else "Jarvis: ${l.size} Hinweise für heute",
            l.joinToString("\n"))
        arm(ctx)
    }
}

class ProactiveReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == "android.intent.action.QUICKBOOT_POWERON") { Proactive.arm(ctx); return }
        Proactive.fire(ctx)
    }
}
