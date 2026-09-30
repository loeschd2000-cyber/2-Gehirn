package de.damian.zweitesgehirn

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.Calendar

/** Tägliche Erinnerung ans Tagebuch (z. B. 21:30). Tippen öffnet Jarvis direkt im Tagebuch-Modus. */
object DiaryReminder {
    private const val CHANNEL = "diary"
    private fun p(ctx: Context) = ctx.getSharedPreferences("zg", Context.MODE_PRIVATE)

    fun time(ctx: Context): Pair<Int, Int>? {
        val h = p(ctx).getInt("diary_h", -1); val m = p(ctx).getInt("diary_m", -1)
        return if (h < 0) null else h to m
    }

    /** h < 0 schaltet die Erinnerung aus */
    fun set(ctx: Context, h: Int, m: Int) {
        p(ctx).edit().putInt("diary_h", h).putInt("diary_m", m).apply()
        arm(ctx)
    }

    private fun pending(ctx: Context) = PendingIntent.getBroadcast(ctx, 7070, Intent(ctx, DiaryReceiver::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    fun arm(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        am.cancel(pending(ctx))
        val t = time(ctx) ?: return
        val c = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, t.first); set(Calendar.MINUTE, t.second); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            if (timeInMillis <= System.currentTimeMillis() + 5000) add(Calendar.DAY_OF_YEAR, 1)
        }
        // Fenster von 5 Minuten reicht für eine Erinnerung und spart Akku
        am.setWindow(AlarmManager.RTC_WAKEUP, c.timeInMillis, 5 * 60 * 1000L, pending(ctx))
    }

    fun notify(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Tagebuch-Erinnerung", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(ctx, 7071,
            Intent(ctx, MainActivity::class.java).putExtra("diary", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("📔 Wie war dein Tag?")
            .setContentText("Tippe hier und erzähl Jarvis von deinem Tag.")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try { nm.notify(7072, n) } catch (_: Throwable) {}
    }
}

class DiaryReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == "android.intent.action.QUICKBOOT_POWERON") {
            DiaryReminder.arm(ctx); return
        }
        DiaryReminder.notify(ctx)
        DiaryReminder.arm(ctx)   // nächster Tag
    }
}
