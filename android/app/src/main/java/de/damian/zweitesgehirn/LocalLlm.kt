package de.damian.zweitesgehirn

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.MessageCallback
import com.google.ai.edge.litertlm.SamplerConfig
import org.json.JSONObject
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Handy-KI: Gemma 4 (E2B) läuft direkt auf dem Handy über LiteRT-LM – ohne Internet und ohne Gemini-Limit.
 * Das Modell (ca. 2,6 GB, Apache-2.0-Lizenz) wird einmal von Hugging Face geladen und im App-Ordner gespeichert.
 * Nach 5 Minuten ohne Nutzung wird es wieder aus dem Speicher genommen (spart Akku und RAM).
 */
object LocalLlm {
    const val URL = "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm"
    const val FILE = "gemma-4-E2B-it.litertlm"
    const val SIZE = 2_588_147_712L
    const val NAME = "Gemma 4 E2B"

    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var engine: Engine? = null
    @Volatile private var backendName = ""
    @Volatile private var loading = false
    @Volatile private var lastUse = 0L
    @Volatile private var lastError = ""

    private fun p(ctx: Context) = ctx.getSharedPreferences("zg_llm", Context.MODE_PRIVATE)
    fun dir(ctx: Context): File = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "models").apply { mkdirs() }
    fun modelFile(ctx: Context) = File(dir(ctx), FILE)
    fun installed(ctx: Context) = modelFile(ctx).let { it.exists() && it.length() >= SIZE * 98 / 100 } && p(ctx).getLong("dl", -1L) < 0

    /** Zustand für die Web-App: none | downloading | paused | failed | installed | loading | ready */
    fun state(ctx: Context): JSONObject {
        val o = JSONObject().put("size", SIZE).put("name", NAME)
        val id = p(ctx).getLong("dl", -1L)
        if (id >= 0) {
            val dm = ctx.getSystemService(DownloadManager::class.java)
            try {
                dm.query(DownloadManager.Query().setFilterById(id))?.use { c ->
                    if (c.moveToFirst()) {
                        val st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                        val done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                        val total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)).let { if (it > 0) it else SIZE }
                        val reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
                        when (st) {
                            DownloadManager.STATUS_SUCCESSFUL -> finishDownload(ctx)
                            DownloadManager.STATUS_FAILED -> { p(ctx).edit().putLong("dl", -1L).apply(); return o.put("state", "failed").put("reason", reason) }
                            DownloadManager.STATUS_PAUSED -> return o.put("state", "paused").put("done", done).put("total", total).put("reason", reason)
                            else -> return o.put("state", "downloading").put("done", done).put("total", total)
                        }
                    } else p(ctx).edit().putLong("dl", -1L).apply()
                }
            } catch (_: Throwable) {}
        }
        if (!installed(ctx)) return o.put("state", "none").put("free", dir(ctx).usableSpace).put("error", lastError)
        return o.put("state", if (engine != null) "ready" else if (loading) "loading" else "installed").put("backend", backendName).put("error", lastError)
    }

    private fun finishDownload(ctx: Context) {
        p(ctx).edit().putLong("dl", -1L).apply()
        // DownloadManager hängt bei vorhandener Datei „-1“ an – richtigen Namen sicherstellen
        val f = modelFile(ctx)
        if (!f.exists()) dir(ctx).listFiles()?.filter { it.name.startsWith("gemma-4-E2B-it") && it.name.endsWith(".litertlm") }?.maxByOrNull { it.length() }?.renameTo(f)
    }

    /** Download starten; mobile=false: nur über WLAN */
    fun download(ctx: Context, mobile: Boolean): String {
        if (installed(ctx)) return "ok"
        if (dir(ctx).usableSpace < SIZE + 300_000_000L) return "Zu wenig Speicher frei (${SIZE / 1_000_000_000.0} GB nötig)"
        val dm = ctx.getSystemService(DownloadManager::class.java)
        val old = p(ctx).getLong("dl", -1L); if (old >= 0) try { dm.remove(old) } catch (_: Throwable) {}
        dir(ctx).listFiles()?.filter { it.name.startsWith("gemma-4-E2B-it") }?.forEach { it.delete() }
        return try {
            val req = DownloadManager.Request(Uri.parse(URL))
                .setTitle("Jarvis Handy-KI")
                .setDescription("$NAME (ca. 2,6 GB) – einmaliger Download")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(ctx, "models", FILE)
                .setAllowedOverMetered(mobile)
                .setAllowedOverRoaming(false)
            val id = dm.enqueue(req)
            p(ctx).edit().putLong("dl", id).apply(); lastError = ""
            "ok"
        } catch (e: Throwable) { e.message ?: "Download ging nicht" }
    }

    fun delete(ctx: Context) {
        val old = p(ctx).getLong("dl", -1L)
        if (old >= 0) try { ctx.getSystemService(DownloadManager::class.java).remove(old) } catch (_: Throwable) {}
        p(ctx).edit().putLong("dl", -1L).apply()
        worker.execute {
            try { engine?.close() } catch (_: Throwable) {}
            engine = null; backendName = ""
            dir(ctx).listFiles()?.forEach { it.delete() }
        }
    }

    private fun ensureEngine(ctx: Context): Engine {
        engine?.let { return it }
        state(ctx)   // fertigen Download übernehmen
        if (!installed(ctx)) throw IllegalStateException("Die Handy-KI ist noch nicht heruntergeladen")
        loading = true
        try {
            var err: Throwable? = null
            // Grafikchip zuerst (schneller, weniger RAM), sonst Prozessor
            for (gpu in listOf(true, false)) {
                try {
                    val e = Engine(EngineConfig(modelPath = modelFile(ctx).absolutePath,
                        backend = if (gpu) Backend.GPU() else Backend.CPU(),
                        maxNumTokens = 4096,
                        cacheDir = ctx.cacheDir.absolutePath))
                    e.initialize()
                    engine = e; backendName = if (gpu) "GPU" else "CPU"; lastError = ""
                    return e
                } catch (t: Throwable) { err = t }
            }
            lastError = err?.message ?: "Modell lädt nicht"
            throw err ?: IllegalStateException("Modell lädt nicht")
        } finally { loading = false }
    }

    /** Modell schon mal laden (z. B. wenn die Handy-KI als Quelle gewählt ist) */
    fun warm(ctx: Context) {
        if (engine != null || loading || !installed(ctx)) return
        worker.execute { try { ensureEngine(ctx); lastUse = SystemClock.elapsedRealtime(); scheduleUnload() } catch (_: Throwable) {} }
    }

    @Volatile private var cancelled = HashSet<String>()
    fun cancel(id: String) { synchronized(cancelled) { cancelled.add(id) } }
    private fun isCancelled(id: String) = synchronized(cancelled) { cancelled.contains(id) }

    /** Antwort erzeugen; onPiece bekommt jedes neue Textstück, onDone(null) = fertig, onDone(Fehler) = Fehler */
    fun generate(ctx: Context, id: String, system: String, prompt: String, temperature: Double, onPiece: (String) -> Unit, onDone: (String?) -> Unit) {
        worker.execute {
            var err: String? = null
            try {
                if (isCancelled(id)) { onDone(null); return@execute }
                val e = ensureEngine(ctx)
                lastUse = SystemClock.elapsedRealtime()
                val conv = e.createConversation(ConversationConfig(
                    systemInstruction = Contents.of(system.ifBlank { "Du bist Jarvis, ein hilfreicher Assistent. Antworte kurz auf Deutsch." }),
                    samplerConfig = SamplerConfig(topK = 40, topP = 0.95, temperature = temperature)))
                try {
                    val latch = CountDownLatch(1)
                    conv.sendMessageAsync(prompt, object : MessageCallback {
                        override fun onMessage(message: Message) { if (!isCancelled(id)) { val t = message.toString(); if (t.isNotEmpty()) onPiece(t) } }
                        override fun onDone() { latch.countDown() }
                        override fun onError(throwable: Throwable) { err = throwable.message ?: "Fehler der Handy-KI"; latch.countDown() }
                    })
                    if (!latch.await(180, TimeUnit.SECONDS)) err = "Die Handy-KI hat zu lange gebraucht"
                } finally { try { conv.close() } catch (_: Throwable) {} }
            } catch (t: Throwable) { err = t.message ?: "Handy-KI-Fehler"; lastError = err ?: "" }
            synchronized(cancelled) { cancelled.remove(id) }
            lastUse = SystemClock.elapsedRealtime()
            onDone(err)
            scheduleUnload()
        }
    }

    private fun scheduleUnload() {
        main.removeCallbacksAndMessages("unload")
        main.postAtTime({
            if (SystemClock.elapsedRealtime() - lastUse >= 5 * 60_000L) worker.execute {
                if (SystemClock.elapsedRealtime() - lastUse >= 5 * 60_000L) { try { engine?.close() } catch (_: Throwable) {}; engine = null; backendName = "" }
            }
        }, "unload", SystemClock.uptimeMillis() + 5 * 60_000L + 1000)
    }
}
