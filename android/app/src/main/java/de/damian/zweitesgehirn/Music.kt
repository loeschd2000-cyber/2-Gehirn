package de.damian.zweitesgehirn

import android.app.SearchManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.util.Log
import android.view.KeyEvent

/**
 * Nur nötig, damit Android uns die laufenden Musik-Player zeigt ("Benachrichtigungszugriff").
 * Wir lesen damit KEINE Nachrichten, sondern steuern nur den Musik-Player.
 */
class MediaListener : NotificationListenerService()

/**
 * Musik im Hintergrund abspielen und steuern, ohne dass Spotify aufgeht.
 * 1. Weg: direkt über die "Mediensitzung" von Spotify (wie Google Assistant / Android Auto).
 * 2. Weg (falls 1 nicht klappt): Spotify-Suche kurz öffnen, abspielen, sofort zurück.
 * Jeder Schritt wird mitgeschrieben, damit man Fehler in den App-Einstellungen sehen kann.
 */
object Music {
    private const val TAG = "ZG-Music"
    const val SPOTIFY = "com.spotify.music"
    private val main = Handler(Looper.getMainLooper())

    /** Protokoll des letzten Versuchs (für "Musik testen") */
    @Volatile var lastLog: String = "Noch nichts abgespielt."
    private val log = StringBuilder()
    private var t0 = 0L
    private fun step(s: String) {
        val line = String.format("%5.1fs  %s", (SystemClock.elapsedRealtime() - t0) / 1000.0, s)
        Log.i(TAG, line); log.append(line).append('\n'); lastLog = log.toString()
    }

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

    private fun title(c: MediaController?) = c?.metadata?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: ""
    private fun artistOf(c: MediaController?) = c?.metadata?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: ""
    private fun isPlaying(c: MediaController?) = c?.playbackState?.state == PlaybackState.STATE_PLAYING
    private fun stateName(c: MediaController?) = when (c?.playbackState?.state) {
        PlaybackState.STATE_PLAYING -> "spielt"; PlaybackState.STATE_PAUSED -> "pausiert"
        PlaybackState.STATE_BUFFERING -> "lädt"; PlaybackState.STATE_STOPPED -> "gestoppt"
        PlaybackState.STATE_NONE -> "leer"; PlaybackState.STATE_ERROR -> "Fehler"; null -> "?"
        else -> "Zustand ${c.playbackState?.state}"
    }

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

    /** Ergebnis: geklappt?, auf welchem Weg ("hintergrund" / "app" / "fehler"), Text */
    fun interface Done { fun done(ok: Boolean, how: String, msg: String) }

    /**
     * Spielt [query] auf Spotify. [openNow] darf Spotify sichtbar starten (nur solange unser Fenster
     * noch vorne ist, sonst blockiert Android das Starten). [backToApp]: danach zurück in die große App.
     */
    fun play(ctx: Context, query: String, artist: String, backToApp: Boolean, done: Done) {
        log.setLength(0); t0 = SystemClock.elapsedRealtime()
        step("Anfrage: „$query“" + if (artist.isNotBlank()) " (Künstler)" else "")
        if (!spotifyInstalled(ctx)) {
            step("Spotify ist nicht installiert → Browser")
            playViaApp(ctx, query, artist, backToApp, done); return
        }
        if (!accessGranted(ctx)) {
            step("Benachrichtigungszugriff fehlt → Weg 2 (Spotify kurz öffnen)")
            playViaApp(ctx, query, artist, backToApp, done); return
        }
        val c = spotify(ctx)
        if (c == null) {
            step("Spotify läuft nicht → wecke Spotify im Hintergrund")
            wakeSpotify(ctx)
            var tries = 0
            fun waitForSession() {
                val s = spotify(ctx)
                if (s != null) { step("Spotify-Sitzung da (${stateName(s)})"); main.postDelayed({ search(ctx, s, query, artist, backToApp, done) }, 500); return }
                if (++tries > 8) { step("Spotify hat sich nicht gemeldet → Weg 2"); playViaApp(ctx, query, artist, backToApp, done); return }
                main.postDelayed({ waitForSession() }, 250)
            }
            main.postDelayed({ waitForSession() }, 300)
            return
        }
        step("Spotify-Sitzung gefunden (${stateName(c)}, läuft: „${title(c)}“)")
        search(ctx, c, query, artist, backToApp, done)
    }

    private fun matches(c: MediaController?, query: String): Boolean {
        val q = query.lowercase().trim()
        val t = title(c).lowercase(); val a = artistOf(c).lowercase()
        if (q.isBlank()) return false
        return (t.isNotBlank() && (t.contains(q) || q.contains(t))) || (a.isNotBlank() && (a.contains(q) || q.contains(a)))
    }

    private fun search(ctx: Context, c: MediaController, query: String, artist: String, backToApp: Boolean, done: Done) {
        val before = title(c)
        val acts = c.playbackState?.actions ?: 0L
        step("Spotify erlaubt Suche: " + if ((acts and PlaybackState.ACTION_PLAY_FROM_SEARCH) != 0L) "ja" else "nicht gemeldet")
        try { c.transportControls.playFromSearch(query, searchExtras(query, artist)); step("Suchbefehl im Hintergrund geschickt") }
        catch (e: Throwable) { step("Suchbefehl abgelehnt (${e.javaClass.simpleName}) → Weg 2"); playViaApp(ctx, query, artist, backToApp, done); return }
        var checks = 0
        fun check() {
            val s = spotify(ctx) ?: c
            val now = title(s)
            if (isPlaying(s) && (now != before || matches(s, query))) {
                step("✓ Läuft im Hintergrund: „$now“ – ${artistOf(s)}")
                done.done(true, "hintergrund", now); return
            }
            if (++checks >= 9) { step("Keine Reaktion (${stateName(s)}, „$now“) → Weg 2"); playViaApp(ctx, query, artist, backToApp, done); return }
            main.postDelayed({ check() }, 400)
        }
        main.postDelayed({ check() }, 500)
    }

    /** Weg 2: Spotify-Suche starten, bei Bedarf Play drücken, dann gleich wieder zurück. */
    private fun playViaApp(ctx: Context, query: String, artist: String, backToApp: Boolean, done: Done) {
        val installed = spotifyInstalled(ctx)
        val i = if (installed) {
            Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).setPackage(SPOTIFY).putExtras(searchExtras(query, artist))
        } else Intent(Intent.ACTION_VIEW, Uri.parse("https://open.spotify.com/search/" + Uri.encode(query)))
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { ctx.startActivity(i); step("Spotify-Suche geöffnet") }
        catch (e: Throwable) { step("Konnte Spotify nicht öffnen: ${e.javaClass.simpleName}"); done.done(false, "fehler", "Spotify ließ sich nicht öffnen"); return }
        if (!installed) { done.done(false, "fehler", "Spotify ist nicht installiert"); return }
        val access = accessGranted(ctx)
        var waited = 0; var pressed = false
        fun back() {
            val s = spotify(ctx)
            val playing = isPlaying(s)
            if (!playing && access && waited < 5000) {
                if (waited >= 2500 && !pressed && s != null) { pressed = true; step("Spotify zeigt nur Ergebnisse → drücke Play"); s.transportControls.play() }
                waited += 300; main.postDelayed({ back() }, 300); return
            }
            if (!access) {
                // Ohne Zugriff sehen wir nicht, ob es läuft: sicherheitshalber Play drücken
                val am = ctx.getSystemService(AudioManager::class.java)
                if (!am.isMusicActive) { step("Drücke Play"); am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY)); am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PLAY)) }
            }
            val home = if (backToApp) Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                       else Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try { ctx.startActivity(home); step(if (backToApp) "Zurück in die App" else "Zurück zum Startbildschirm") }
            catch (e: Throwable) { step("Zurückspringen blockiert: ${e.javaClass.simpleName}") }
            val ok = !access || isPlaying(spotify(ctx))
            step(if (ok) "✓ Fertig (über Spotify)" else "✗ Spotify spielt nicht")
            done.done(ok, "app", if (ok) title(spotify(ctx)) else "Spotify hat nicht angefangen zu spielen")
        }
        main.postDelayed({ back() }, if (access) 900 else 3000)
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
