package de.damian.zweitesgehirn

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.WebView
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject

/**
 * Jarvis auf der Smartwatch: Die Uhr schickt den gesprochenen Satz ans Handy („/jarvis/ask“),
 * das Handy lässt ihn von einem unsichtbaren Jarvis (wie im Auto) bearbeiten und schickt die Antwort zurück.
 */
object WatchBrain {
    private val main = Handler(Looper.getMainLooper())
    private var web: WebView? = null
    private var bridge: NativeBridge? = null
    @Volatile private var node = ""
    @Volatile private var lastUse = 0L
    private var appCtx: Context? = null

    fun send(path: String, text: String) {
        val ctx = appCtx ?: return; val n = node; if (n.isBlank()) return
        try { Wearable.getMessageClient(ctx).sendMessage(n, path, text.toByteArray(Charsets.UTF_8)) } catch (_: Throwable) {}
    }

    private fun start(ctx: Context): Boolean {
        if (bridge != null) return true
        if (Prefs.appUrl(ctx).isBlank()) { send("/jarvis/answer", "Richte Jarvis zuerst einmal in der App am Handy ein."); return false }
        return try {
            val app = ctx.applicationContext; appCtx = app
            val w = WebView(app)
            val b = NativeBridge(app, w, mini = false, car = true, watch = true)
            b.carIntent = { false }   // Anrufe/Navigation gehen von der Uhr aus nicht über ein Auto-Display
            b.carShow = { who, text -> send(if (who == "du") "/jarvis/heard" else "/jarvis/answer", text) }
            b.carState = { st -> send("/jarvis/state", st) }
            b.carListen = { send("/jarvis/listen", "") }   // Rückfrage: Uhr hört gleich wieder zu
            b.setup(); b.loadStart()
            web = w; bridge = b
            true
        } catch (e: Throwable) { send("/jarvis/answer", "Jarvis konnte am Handy nicht starten: ${e.message ?: "Fehler"}"); false }
    }

    fun ask(ctx: Context, fromNode: String, text: String) {
        appCtx = ctx.applicationContext; node = fromNode; lastUse = SystemClock.elapsedRealtime()
        main.post {
            if (!start(ctx)) return@post
            send("/jarvis/state", "Denkt nach …")
            val code = "(window.__zgCarAsk && (__zgCarAsk(" + JSONObject.quote(text) + "), true)) ? 'ok' : 'wait'"
            fun tryIt(n: Int) {
                val w = web ?: return
                w.evaluateJavascript(code) { r ->
                    if (r?.contains("ok") != true) { if (n < 40) main.postDelayed({ tryIt(n + 1) }, 500) else send("/jarvis/answer", "Jarvis am Handy antwortet nicht. Ist Internet da?") }
                }
            }
            tryIt(0)
            scheduleStop()
        }
    }

    private fun scheduleStop() {
        main.removeCallbacksAndMessages("stop")
        main.postAtTime({
            if (SystemClock.elapsedRealtime() - lastUse >= 5 * 60_000L) { try { bridge?.destroy() } catch (_: Throwable) {}; bridge = null; web = null }
            else scheduleStop()
        }, "stop", SystemClock.uptimeMillis() + 5 * 60_000L + 500)
    }
}

/** Empfängt Nachrichten von der Uhr (auch wenn die App zu ist) */
class JarvisWearService : WearableListenerService() {
    override fun onMessageReceived(ev: MessageEvent) {
        when (ev.path) {
            "/jarvis/ask" -> { val t = String(ev.data, Charsets.UTF_8).trim().take(500); if (t.isNotBlank()) WatchBrain.ask(applicationContext, ev.sourceNodeId, t) }
            "/jarvis/ping" -> try { Wearable.getMessageClient(this).sendMessage(ev.sourceNodeId, "/jarvis/pong", ByteArray(0)) } catch (_: Throwable) {}
        }
    }
}
