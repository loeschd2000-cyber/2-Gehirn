package de.damian.zweitesgehirn

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.provider.AlarmClock
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Gemeinsame Benachrichtigung (öffnet die App beim Antippen) */
object Notes {
    fun show(ctx: Context, channel: String, channelName: String, id: Int, title: String, text: String) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(channel) == null)
            nm.createNotificationChannel(NotificationChannel(channel, channelName, NotificationManager.IMPORTANCE_HIGH))
        val open = PendingIntent.getActivity(ctx, id, Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(ctx, channel).setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title).setContentText(text).setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(open).setAutoCancel(true).build()
        try { nm.notify(id, n) } catch (_: Throwable) {}
    }
}

/** Erinnerungen: „Erinner mich morgen um 16 Uhr an die Hausaufgaben“ – klingelt als Benachrichtigung, auch wenn die App zu ist. */
object Reminders {
    private fun p(ctx: Context) = ctx.getSharedPreferences("zg", Context.MODE_PRIVATE)
    fun list(ctx: Context): JSONArray = try { JSONArray(p(ctx).getString("reminders", "[]")) } catch (_: Throwable) { JSONArray() }
    private fun save(ctx: Context, a: JSONArray) = p(ctx).edit().putString("reminders", a.toString()).apply()

    private fun pending(ctx: Context, id: Int) = PendingIntent.getBroadcast(ctx, id,
        Intent(ctx, ReminderReceiver::class.java).putExtra("id", id), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun arm(ctx: Context, id: Int, at: Long) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        try { am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx, id)) }
        catch (_: SecurityException) { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx, id)) }
    }

    @Synchronized fun add(ctx: Context, at: Long, text: String): Int {
        val id = 30000 + ((at / 1000 + text.hashCode()) % 900000).toInt().let { if (it < 0) -it else it }
        val a = list(ctx); a.put(JSONObject().put("id", id).put("at", at).put("text", text)); save(ctx, a)
        arm(ctx, id, at); return id
    }
    @Synchronized fun cancel(ctx: Context, id: Int) {
        val a = list(ctx); val keep = JSONArray()
        for (i in 0 until a.length()) { val o = a.getJSONObject(i)
            if (id == -1 || o.getInt("id") == id) ctx.getSystemService(AlarmManager::class.java).cancel(pending(ctx, o.getInt("id"))) else keep.put(o) }
        save(ctx, keep)
    }
    @Synchronized fun fire(ctx: Context, id: Int) {
        val a = list(ctx); val keep = JSONArray(); var text = "Erinnerung"
        for (i in 0 until a.length()) { val o = a.getJSONObject(i); if (o.getInt("id") == id) text = o.optString("text") else keep.put(o) }
        save(ctx, keep)
        Notes.show(ctx, "reminder", "Erinnerungen", id, "⏰ Erinnerung", text)
    }
    fun rearm(ctx: Context) {
        val a = list(ctx); val now = System.currentTimeMillis(); val keep = JSONArray()
        for (i in 0 until a.length()) { val o = a.getJSONObject(i)
            if (o.getLong("at") > now - 60000) { keep.put(o); arm(ctx, o.getInt("id"), maxOf(o.getLong("at"), now + 5000)) } }
        save(ctx, keep)
    }
}
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == "android.intent.action.QUICKBOOT_POWERON") { Reminders.rearm(ctx); PriceAlerts.arm(ctx); return }
        Reminders.fire(ctx, intent.getIntExtra("id", 0))
    }
}

/** Kurs-Alarm: prüft etwa alle 15 Minuten (CoinGecko, kostenlos) und meldet sich, wenn die Grenze erreicht ist. */
object PriceAlerts {
    private fun p(ctx: Context) = ctx.getSharedPreferences("zg", Context.MODE_PRIVATE)
    fun list(ctx: Context): JSONArray = try { JSONArray(p(ctx).getString("price_alerts", "[]")) } catch (_: Throwable) { JSONArray() }
    private fun save(ctx: Context, a: JSONArray) { p(ctx).edit().putString("price_alerts", a.toString()).apply(); arm(ctx) }
    private fun pending(ctx: Context) = PendingIntent.getBroadcast(ctx, 8080, Intent(ctx, PriceReceiver::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    @Synchronized fun add(ctx: Context, coinId: String, symbol: String, below: Boolean, price: Double, currency: String): Int {
        val id = ((System.nanoTime() / 1000) % 900000).toInt().let { if (it < 0) -it else it } + 1000
        val a = list(ctx)
        a.put(JSONObject().put("id", id).put("coin", coinId).put("sym", symbol).put("below", below).put("price", price).put("cur", currency))
        save(ctx, a); return id
    }
    @Synchronized fun cancel(ctx: Context, id: Int) {
        val a = list(ctx); val keep = JSONArray()
        for (i in 0 until a.length()) if (id != -1 && a.getJSONObject(i).getInt("id") != id) keep.put(a.getJSONObject(i))
        save(ctx, keep)
    }
    fun arm(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        am.cancel(pending(ctx))
        if (list(ctx).length() == 0) return
        am.setInexactRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + 60000,
            AlarmManager.INTERVAL_FIFTEEN_MINUTES, pending(ctx))
    }
    /** Hintergrund-Thread! Die Internet-Abfrage läuft ohne Sperre, damit die App nicht hängt. */
    fun check(ctx: Context) {
        val a0 = synchronized(this) { list(ctx) }; if (a0.length() == 0) return
        val a = a0
        val ids = (0 until a.length()).map { a.getJSONObject(it).optString("coin") }.distinct().joinToString(",")
        val json = try {
            val c = URL("https://api.coingecko.com/api/v3/simple/price?ids=$ids&vs_currencies=usd,eur").openConnection() as HttpURLConnection
            c.connectTimeout = 15000; c.readTimeout = 15000
            val t = c.inputStream.bufferedReader().readText(); c.disconnect(); JSONObject(t)
        } catch (_: Throwable) { return }
        val hitIds = HashSet<Int>()
        for (i in 0 until a.length()) {
            val o = a.getJSONObject(i)
            val now = json.optJSONObject(o.optString("coin"))?.optDouble(o.optString("cur", "usd"), Double.NaN) ?: Double.NaN
            val hit = !now.isNaN() && (if (o.optBoolean("below")) now <= o.optDouble("price") else now >= o.optDouble("price"))
            if (hit) {
                val cur = if (o.optString("cur") == "eur") "€" else "$"
                Notes.show(ctx, "price", "Kurs-Alarm", 9000 + (o.getInt("id") % 999), "📈 Kurs-Alarm: ${o.optString("sym")}",
                    "${o.optString("sym")} ist jetzt bei ${"%.4f".format(now).trimEnd('0').trimEnd(',', '.')} $cur – " +
                    (if (o.optBoolean("below")) "unter" else "über") + " deiner Grenze von ${o.optDouble("price")} $cur.")
                hitIds += o.getInt("id")
            }
        }
        if (hitIds.isNotEmpty()) synchronized(this) {
            // aktuelle Liste neu lesen (könnte sich inzwischen geändert haben) und nur die ausgelösten entfernen
            val cur = list(ctx); val keep = JSONArray()
            for (i in 0 until cur.length()) { val o = cur.getJSONObject(i); if (o.getInt("id") !in hitIds) keep.put(o) }
            save(ctx, keep)
        }
    }
}
class PriceReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val r = goAsync()
        Thread { try { PriceAlerts.check(ctx) } finally { r.finish() } }.start()
    }
}

/** Timer und Navigation über die Apps des Handys */
object Phone {
    fun timer(ctx: Context, seconds: Int, label: String) {
        val i = Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH, seconds)
            .putExtra(AlarmClock.EXTRA_MESSAGE, label).putExtra(AlarmClock.EXTRA_SKIP_UI, true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { ctx.startActivity(i) } catch (_: Throwable) {}
    }
    /** start=true: Navigation sofort starten, sonst Route mit Fahrzeit anzeigen */
    fun maps(ctx: Context, dest: String, mode: String, start: Boolean) {
        val m = when (mode) { "walk" -> "w"; "bike" -> "b"; "transit" -> "r"; else -> "d" }
        val tm = when (mode) { "walk" -> "walking"; "bike" -> "bicycling"; "transit" -> "transit"; else -> "driving" }
        val uri = if (start && mode != "transit") Uri.parse("google.navigation:q=" + Uri.encode(dest) + "&mode=" + m)
                  else Uri.parse("https://www.google.com/maps/dir/?api=1&destination=" + Uri.encode(dest) + "&travelmode=" + tm)
        val i = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { ctx.startActivity(Intent(i).setPackage("com.google.android.apps.maps")) }
        catch (_: Throwable) { try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/dir/?api=1&destination=" + Uri.encode(dest) + "&travelmode=" + tm)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Throwable) {} }
    }
}
