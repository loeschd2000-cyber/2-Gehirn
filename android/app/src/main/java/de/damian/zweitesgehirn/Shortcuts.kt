package de.damian.zweitesgehirn

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.widget.RemoteViews

/** Startbildschirm-Widget: Mikrofon (kleiner Kreis hört sofort zu), Briefing, Tagebuch */
class JarvisWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) mgr.updateAppWidget(id, views(ctx))
    }
    companion object {
        fun listenIntent(ctx: Context) = Intent(ctx, MiniActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("wake", true)
        private fun pi(ctx: Context, code: Int, i: Intent) =
            PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        fun views(ctx: Context) = RemoteViews(ctx.packageName, R.layout.widget_jarvis).apply {
            val listen = pi(ctx, 7401, listenIntent(ctx))
            setOnClickPendingIntent(R.id.w_mic, listen)
            setOnClickPendingIntent(R.id.w_root, listen)
            setOnClickPendingIntent(R.id.w_brief, pi(ctx, 7402, Intent(ctx, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("widget", "brief")))
            setOnClickPendingIntent(R.id.w_diary, pi(ctx, 7403, Intent(ctx, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("diary", true)))
        }
    }
}

/** Kachel in den Schnelleinstellungen (Wischen von oben): ein Tipp und Jarvis hört zu */
class JarvisTile : TileService() {
    override fun onStartListening() {
        qsTile?.apply { state = Tile.STATE_INACTIVE; label = "Jarvis"; if (Build.VERSION.SDK_INT >= 29) subtitle = "Tippen und sprechen"; updateTile() }
    }
    override fun onClick() {
        val i = JarvisWidget.listenIntent(this)
        try {
            if (Build.VERSION.SDK_INT >= 34)
                startActivityAndCollapse(PendingIntent.getActivity(this, 7404, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            else @Suppress("DEPRECATION") startActivityAndCollapse(i)
        } catch (_: Throwable) { try { startActivity(i) } catch (_: Throwable) {} }
    }
}
