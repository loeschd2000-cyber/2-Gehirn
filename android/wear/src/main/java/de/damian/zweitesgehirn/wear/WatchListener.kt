package de.damian.zweitesgehirn.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

/** Antwort kommt, während die Jarvis-App auf der Uhr nicht offen ist: als Benachrichtigung zeigen */
class WatchListener : WearableListenerService() {
    companion object { const val NOTE_ID = 42 }
    override fun onMessageReceived(ev: MessageEvent) {
        if (ev.path != "/jarvis/answer" || MainActivity.visible) return
        val t = String(ev.data, Charsets.UTF_8)
        MainActivity.lastAnswer = t
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel("jarvis") == null) nm.createNotificationChannel(NotificationChannel("jarvis", "Jarvis", NotificationManager.IMPORTANCE_HIGH))
        val open = PendingIntent.getActivity(this, 1, Intent(this, MainActivity::class.java).putExtra("answer", t).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = Notification.Builder(this, "jarvis").setSmallIcon(R.drawable.ic_stat).setContentTitle("Jarvis")
            .setContentText(t).setStyle(Notification.BigTextStyle().bigText(t)).setContentIntent(open).setAutoCancel(true).build()
        try { nm.notify(NOTE_ID, n) } catch (_: Throwable) {}
    }
}
