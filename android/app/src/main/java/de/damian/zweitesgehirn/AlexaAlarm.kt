package de.damian.zweitesgehirn

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Alexa-Wecker über Voice Monkey: Jarvis merkt sich die Weckzeit und startet zur Weckzeit
 * deine Alexa-Routine (über einen "Routine Trigger" bei Voice Monkey). Läuft auch, wenn die App zu ist.
 */
object AlexaAlarm {
    private const val CHANNEL = "alexa"
    private fun p(ctx: Context) = ctx.getSharedPreferences("zg", Context.MODE_PRIVATE)

    fun token(ctx: Context) = Secure.get(p(ctx), "vm_token")
    fun device(ctx: Context) = p(ctx).getString("vm_device", "") ?: ""
    fun configured(ctx: Context) = token(ctx).isNotBlank() && device(ctx).isNotBlank()
    fun configure(ctx: Context, token: String, device: String) {
        val e = p(ctx).edit().putString("vm_device", device.trim())
        if (token != "__keep__") e.putString("vm_token", Secure.enc(token.trim()))   // leer lassen = alten Token behalten
        e.apply()
    }

    fun list(ctx: Context): JSONArray = try { JSONArray(p(ctx).getString("alarms", "[]")) } catch (_: Throwable) { JSONArray() }
    private fun save(ctx: Context, arr: JSONArray) = p(ctx).edit().putString("alarms", arr.toString()).apply()

    /** Wecker stellen. Gibt die ID zurück. */
    @Synchronized fun schedule(ctx: Context, atMillis: Long, label: String): Int {
        val id = ((atMillis / 60000) % Int.MAX_VALUE).toInt()
        val arr = list(ctx)
        val keep = JSONArray()
        for (i in 0 until arr.length()) if (arr.getJSONObject(i).getInt("id") != id) keep.put(arr.getJSONObject(i))
        keep.put(JSONObject().put("id", id).put("at", atMillis).put("label", label))
        save(ctx, keep)
        arm(ctx, id, atMillis)
        return id
    }

    @Synchronized fun cancel(ctx: Context, id: Int) {
        val arr = list(ctx)
        val keep = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (id == -1 || o.getInt("id") == id) ctx.getSystemService(AlarmManager::class.java).cancel(pending(ctx, o.getInt("id")))
            else keep.put(o)
        }
        save(ctx, keep)
    }

    @Synchronized fun remove(ctx: Context, id: Int) {
        val arr = list(ctx)
        val keep = JSONArray()
        for (i in 0 until arr.length()) if (arr.getJSONObject(i).getInt("id") != id) keep.put(arr.getJSONObject(i))
        save(ctx, keep)
    }

    /** Nach einem Neustart des Handys alle Wecker wieder scharf stellen. */
    fun rearmAll(ctx: Context) {
        val arr = list(ctx)
        val now = System.currentTimeMillis()
        val keep = JSONArray()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            if (o.getLong("at") > now - 60000) { keep.put(o); arm(ctx, o.getInt("id"), o.getLong("at")) }
        }
        save(ctx, keep)
    }

    private fun pending(ctx: Context, id: Int): PendingIntent =
        PendingIntent.getBroadcast(ctx, id, Intent(ctx, AlarmReceiver::class.java).putExtra("id", id),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun arm(ctx: Context, id: Int, at: Long) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val show = PendingIntent.getActivity(ctx, 0, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        try {
            am.setAlarmClock(AlarmManager.AlarmClockInfo(at, show), pending(ctx, id))
        } catch (_: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx, id))   // ungenauer, aber besser als nichts
        }
    }

    /** Startet die Alexa-Routine über Voice Monkey. Rückgabe: (geklappt, Meldung) */
    fun trigger(ctx: Context): Pair<Boolean, String> {
        if (!configured(ctx)) return false to "Voice Monkey ist noch nicht eingerichtet"
        val url = "https://api-v3.voicemonkey.io/trigger?token=" + URLEncoder.encode(token(ctx), "UTF-8") +
            "&device=" + URLEncoder.encode(device(ctx), "UTF-8")
        var last = ""
        repeat(3) { attempt ->
            try {
                val c = URL(url).openConnection() as HttpURLConnection
                c.connectTimeout = 6000; c.readTimeout = 6000
                val code = c.responseCode
                val body = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: ""
                c.disconnect()
                if (code in 200..299 && body.contains("true")) return true to "Alexa-Routine gestartet"
                last = "Voice Monkey antwortet mit Fehler $code"
                if (code in 400..499 && code != 429) return false to last
            } catch (e: Throwable) { last = "Keine Verbindung (${e.javaClass.simpleName})" }
            if (attempt < 2) Thread.sleep(2000L * (attempt + 1))   // insgesamt unter ~45 s bleiben (sonst bricht Android ab)
        }
        return false to last
    }

    fun notify(ctx: Context, ok: Boolean, text: String) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Alexa-Wecker", NotificationManager.IMPORTANCE_DEFAULT))
        val n = Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(if (ok) "Alexa-Wecker ausgelöst" else "Alexa-Wecker hat nicht geklappt")
            .setContentText(text)
            .setAutoCancel(true)
            .build()
        try { nm.notify(2000 + (System.currentTimeMillis() % 1000).toInt(), n) } catch (_: Throwable) {}
    }
}

/** Wird zur Weckzeit (und nach einem Neustart) von Android aufgerufen. */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == "android.intent.action.QUICKBOOT_POWERON") {
            AlexaAlarm.rearmAll(ctx); return
        }
        val id = intent.getIntExtra("id", 0)
        val result = goAsync()
        Thread {
            try {
                val (ok, msg) = AlexaAlarm.trigger(ctx)
                AlexaAlarm.remove(ctx, id)
                AlexaAlarm.notify(ctx, ok, msg)
            } finally { result.finish() }
        }.start()
    }
}
