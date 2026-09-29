package de.damian.zweitesgehirn

import android.app.SearchManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.util.Log
import android.view.KeyEvent

/**
 * Nur nötig, damit Android uns die laufenden Musik-Player zeigt ("Benachrichtigungszugriff").
 * Wir lesen damit KEINE Nachrichten, sondern steuern nur Spotify direkt.
 */
class MediaListener : NotificationListenerService()

/**
 * Musik im Hintergrund abspielen und steuern, ohne dass Spotify aufgeht.
 * Weg: direkt über die "Mediensitzung" von Spotify (wie Google Assistant / Android Auto).
 * Klappt das nicht, startet Spotify kurz und wir gehen sofort wieder zurück.
 */
object Music {
    private const val TAG = "ZG-Music"
    const val SPOTIFY = "com.spotify.music"
    private val main = Handler(Looper.getMainLooper())

    fun spotifyInstalled(ctx: Context) =
        try { ctx.packageManager.getPackageInfo(SPOTIFY, 0); true } catch (_: Throwable) { false }

    /** Hat der Nutzer den Benachrichtigungszugriff erlaubt? */
    fun accessGranted(ctx: Context): Boolean {
        val s = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
        return s.split(":").any { it.startsWith(ctx.packageName + "/") }
    }

    fun openAccessSettings(ctx: Context) {
        val i = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { ctx.startActivity(i) } catch (_: Throwable) {}
    }

    private fun sessions(ctx: Context): List<MediaController> {
        if (!accessGranted(ctx)) return emptyList()
        return try {
            ctx.getSystemService(MediaSessionManager::class.java)
                .getActiveSessions(ComponentName(ctx, MediaListener::class.java))
        } catch (e: Throwable) { Log.w(TAG, "Keine Mediensitzungen", e); emptyList() }
    }

    private fun spotify(ctx: Context) = sessions(ctx).firstOrNull { it.packageName == SPOTIFY }

    /** Der Player, der gerade spielt (oder zuletzt gespielt hat). Spotify wird bevorzugt. */
    private fun current(ctx: Context): MediaController? {
        val all = sessions(ctx)
        return all.firstOrNull { it.playbackState?.state == PlaybackState.STATE_PLAYING }
            ?: all.firstOrNull { it.packageName == SPOTIFY } ?: all.firstOrNull()
    }

    private fun title(c: MediaController?) =
        c?.metadata?.getString(android.media.MediaMetadata.METADATA_KEY_TITLE) ?: ""

    private fun searchExtras(query: String, artist: String) = Bundle().apply {
        putString(SearchManager.QUERY, query)
        if (artist.isNotBlank()) {
            putString(MediaStore.EXTRA_MEDIA_FOCUS, MediaStore.Audio.Artists.ENTRY_CONTENT_TYPE)
            putString(MediaStore.EXTRA_MEDIA_ARTIST, artist)
        } else putString(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/*")
    }

    /** Spotify im Hintergrund "aufwecken", ohne es zu öffnen (wie die Play-Taste am Kopfhörer). */
    private fun wakeSpotify(ctx: Context) {
        for (a in listOf(KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP)) {
            val i = Intent(Intent.ACTION_MEDIA_BUTTON).setPackage(SPOTIFY)
                .putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(a, KeyEvent.KEYCODE_MEDIA_PLAY))
            try { ctx.sendBroadcast(i) } catch (_: Throwable) {}
        }
    }

    /**
     * Spielt [query] auf Spotify. [fallback] wird aufgerufen, wenn es im Hintergrund nicht geklappt hat.
     */
    fun play(ctx: Context, query: String, artist: String, fallback: () -> Unit) {
        if (!accessGranted(ctx)) { fallback(); return }
        val c = spotify(ctx)
        if (c == null) {
            // Spotify läuft noch nicht: im Hintergrund starten und auf seine Mediensitzung warten
            wakeSpotify(ctx)
            var tries = 0
            fun waitForSession() {
                val s = spotify(ctx)
                if (s != null) { main.postDelayed({ search(ctx, s, query, artist, fallback) }, 600); return }
                if (++tries > 12) { fallback(); return }
                main.postDelayed({ waitForSession() }, 300)
            }
            main.postDelayed({ waitForSession() }, 400)
            return
        }
        search(ctx, c, query, artist, fallback)
    }

    private fun search(ctx: Context, c: MediaController, query: String, artist: String, fallback: () -> Unit) {
        val before = title(c)
        try { c.transportControls.playFromSearch(query, searchExtras(query, artist)) }
        catch (e: Throwable) { Log.w(TAG, "playFromSearch geht nicht", e); fallback(); return }
        // Prüfen, ob wirklich etwas Neues läuft. Sonst der sichere Weg.
        var checks = 0
        fun check() {
            val s = spotify(ctx) ?: c
            val now = title(s)
            val playing = s.playbackState?.state == PlaybackState.STATE_PLAYING ||
                s.playbackState?.state == PlaybackState.STATE_BUFFERING
            val q = query.lowercase()
            if (playing && (now != before || (now.isNotBlank() && (now.lowercase().contains(q) || q.contains(now.lowercase()))))) return
            if (++checks >= 10) { Log.i(TAG, "Hintergrund-Suche ohne Wirkung, nehme den sicheren Weg"); fallback(); return }
            main.postDelayed({ check() }, 400)
        }
        main.postDelayed({ check() }, 600)
    }

    /** Der sichere Weg: Spotify-Suche starten und nach kurzer Zeit wieder zurück, damit du Spotify kaum siehst. */
    fun playViaApp(ctx: Context, query: String, artist: String, backToApp: Boolean) {
        val installed = spotifyInstalled(ctx)
        val i = if (installed) {
            Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).setPackage(SPOTIFY).putExtras(searchExtras(query, artist))
        } else Intent(Intent.ACTION_VIEW, Uri.parse("https://open.spotify.com/search/" + Uri.encode(query)))
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { ctx.startActivity(i) } catch (_: Throwable) { return }
        if (!installed) return
        // warten, bis Spotify spielt, dann zurück (in die App oder auf den Startbildschirm)
        var waited = 0
        fun back() {
            val playing = spotify(ctx)?.playbackState?.state == PlaybackState.STATE_PLAYING
            if (!playing && waited < 4000 && accessGranted(ctx)) { waited += 300; main.postDelayed({ back() }, 300); return }
            val home = if (backToApp) Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                       else Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try { ctx.startActivity(home) } catch (_: Throwable) {}
        }
        main.postDelayed({ back() }, if (accessGranted(ctx)) 1200 else 2500)
    }

    /** Weiter, Pause, nächstes/vorheriges Lied – direkt an den Player, ohne ihn zu öffnen. */
    fun control(ctx: Context, cmd: String) {
        val am = ctx.getSystemService(AudioManager::class.java)
        val c = current(ctx)
        if (c != null) {
            val t = c.transportControls
            when (cmd) {
                "next" -> t.skipToNext()
                "previous" -> t.skipToPrevious()
                "pause" -> t.pause()
                "play" -> t.play()
            }
            return
        }
        if (cmd == "play" && spotifyInstalled(ctx) && !am.isMusicActive) { wakeSpotify(ctx); return }
        val code = when (cmd) {
            "next" -> KeyEvent.KEYCODE_MEDIA_NEXT
            "previous" -> KeyEvent.KEYCODE_MEDIA_PREVIOUS
            "pause" -> KeyEvent.KEYCODE_MEDIA_PAUSE
            "play" -> KeyEvent.KEYCODE_MEDIA_PLAY
            else -> return
        }
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
    }
}
