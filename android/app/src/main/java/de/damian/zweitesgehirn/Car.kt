package de.damian.zweitesgehirn

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.WebView
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.media.CarAudioRecord
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.MessageTemplate
import androidx.car.app.model.Template
import androidx.car.app.validation.HostValidator
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import java.io.ByteArrayOutputStream
import kotlin.math.sqrt

/**
 * Jarvis in Android Auto: ein Bildschirm mit „Sprechen“-Knopf.
 * Aufnahme übers Auto-Mikrofon → Gemini schreibt mit → dieselbe Jarvis-Logik wie am Handy
 * (läuft in einer unsichtbaren Web-Ansicht) → Antwort über die Auto-Lautsprecher und als Text.
 */
class CarJarvisService : CarAppService() {
    // Die App kommt nicht aus dem Play Store, deshalb alle Android-Auto-Versionen zulassen
    override fun createHostValidator(): HostValidator = HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
    override fun onCreateSession(): Session = CarJarvisSession()
}

class CarJarvisSession : Session() {
    override fun onCreateScreen(intent: Intent): Screen = JarvisCarScreen(carContext)
}

class JarvisCarScreen(ctx: CarContext) : Screen(ctx) {
    private val main = Handler(Looper.getMainLooper())
    private var status = "Tippe auf „Sprechen“ und sag, was du brauchst."
    private var youSaid = ""
    private var answer = ""
    private var recording = false
    private var web: WebView? = null
    private var bridge: NativeBridge? = null
    private var recorder: CarRecorder? = null
    private var focus: AudioFocusRequest? = null
    private var pendingRefresh = false

    init {
        startBrain()
        lifecycle.addObserver(LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_DESTROY) stopBrain() })
    }

    /** Die Jarvis-Web-App unsichtbar starten (gleiche Daten wie am Handy) */
    private fun startBrain() {
        if (Prefs.appUrl(carContext).isBlank()) { status = "Richte Jarvis zuerst einmal in der App am Handy ein."; return }
        try {
            val w = WebView(carContext.applicationContext)
            val b = NativeBridge(carContext.applicationContext, w, mini = false, car = true)
            b.carIntent = { i -> try { carContext.startCarApp(i); true } catch (_: Throwable) { false } }
            b.carShow = { who, text -> if (who == "du") youSaid = text else answer = text; refresh() }
            b.carState = { s -> status = when (s) { "bereit" -> "Tippe auf „Sprechen“."; else -> s }; refresh() }
            b.carListen = { if (!recording) startListening() }
            b.setup()
            b.loadStart()
            web = w; bridge = b
        } catch (e: Throwable) {
            status = "Jarvis konnte im Auto nicht starten: ${e.message ?: "Fehler"}"
        }
    }

    private fun stopBrain() {
        recorder?.abort(); recorder = null
        releaseFocus()
        try { bridge?.destroy() } catch (_: Throwable) {}
        bridge = null; web = null
    }

    /** Anzeige neu zeichnen – gebündelt, damit Android Auto nicht zu oft neu malen muss */
    private fun refresh() {
        if (pendingRefresh) return
        pendingRefresh = true
        main.postDelayed({ pendingRefresh = false; try { invalidate() } catch (_: Throwable) {} }, 250)
    }

    private fun js(code: String) { main.post { try { web?.evaluateJavascript(code, null) } catch (_: Throwable) {} } }

    private fun onSpeakPressed() {
        if (recording) { recorder?.stop(); return }
        startListening()
    }

    @SuppressLint("MissingPermission")
    private fun startListening() {
        if (bridge == null) { refresh(); return }
        if (carContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            status = "Jarvis darf das Mikrofon noch nicht benutzen. Öffne einmal die App am Handy und erlaube es."; refresh(); return
        }
        if (carContext.carAppApiLevel < 5) { status = "Dein Android Auto ist zu alt für Sprache. Bitte Android Auto aktualisieren."; refresh(); return }
        js("window.__zgCarHush && __zgCarHush()")   // Jarvis hört auf zu reden
        if (!takeFocus()) { status = "Das Auto-Mikrofon ist gerade belegt."; refresh(); return }
        recording = true; status = "🎙 Ich höre zu …"; youSaid = ""; refresh()
        val r = CarRecorder(carContext) { type, info ->
            main.post {
                when (type) {
                    "speech" -> { status = "🎙 Ich höre zu … (tippe „Sprechen“ zum Beenden)"; refresh() }
                    "end" -> {
                        recording = false; releaseFocus()
                        if (info == null) { status = "Ich habe nichts gehört. Tippe nochmal auf „Sprechen“."; refresh() }
                        else {
                            status = "Versteht …"; refresh()
                            bridge?.carAudio = info
                            js("window.__zgCarAudio && __zgCarAudio()")
                        }
                    }
                    "error" -> { recording = false; releaseFocus(); status = "Mikrofon-Fehler: ${info ?: ""}"; refresh() }
                }
            }
        }
        recorder = r
        r.start()
    }

    private fun takeFocus(): Boolean {
        return try {
            val am = carContext.getSystemService(AudioManager::class.java)
            val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setOnAudioFocusChangeListener { f -> if (f == AudioManager.AUDIOFOCUS_LOSS) recorder?.stop() }
                .build()
            val ok = am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
            if (ok) focus = req
            ok
        } catch (_: Throwable) { true }
    }
    private fun releaseFocus() {
        val f = focus ?: return; focus = null
        try { carContext.getSystemService(AudioManager::class.java).abandonAudioFocusRequest(f) } catch (_: Throwable) {}
    }

    private fun ask(text: String) {
        if (bridge == null) { refresh(); return }
        youSaid = text; status = "Denkt nach …"; refresh()
        js("window.__zgCarAsk && __zgCarAsk(" + org.json.JSONObject.quote(text) + ")")
    }

    override fun onGetTemplate(): Template {
        val msg = buildString {
            if (youSaid.isNotBlank()) append("Du: ").append(youSaid.take(120)).append("\n\n")
            if (answer.isNotBlank()) append(answer.take(350)).append("\n\n")
            append(status)
        }
        val speak = Action.Builder().setTitle("Sprechen").setFlags(Action.FLAG_PRIMARY)
            .setOnClickListener { onSpeakPressed() }.build()
        val brief = Action.Builder().setTitle("Briefing").setOnClickListener { ask("Guten Morgen") }.build()
        val strip = ActionStrip.Builder()
            .addAction(Action.Builder().setTitle("Musik").setOnClickListener { ask("Spiel die Musik weiter") }.build())
            .addAction(Action.Builder().setTitle("Stopp").setOnClickListener {
                recorder?.abort(); recording = false; releaseFocus()
                js("window.__zgCarHush && __zgCarHush()"); status = "Tippe auf „Sprechen“."; refresh()
            }.build())
            .build()
        return MessageTemplate.Builder(msg)
            .setTitle("Jarvis")
            .setHeaderAction(Action.APP_ICON)
            .addAction(speak)
            .addAction(brief)
            .setActionStrip(strip)
            .build()
    }
}

/** Aufnahme übers Auto-Mikrofon, bis du fertig gesprochen hast. Ergebnis: WAV als Base64 (oder null = nichts gesagt). */
class CarRecorder(private val ctx: CarContext, private val onEvent: (String, String?) -> Unit) {
    @Volatile private var flag = 0   // 0 läuft, 1 fertig, 2 abbrechen
    fun stop() { flag = 1 }
    fun abort() { flag = 2 }

    @SuppressLint("MissingPermission")
    fun start() {
        Thread({
            WakeService.setMicBusy(true)
            var rec: CarAudioRecord? = null
            try {
                rec = CarAudioRecord.create(ctx)
                rec.startRecording()
                val pcm = ByteArrayOutputStream()
                val buf = ByteArray(CarAudioRecord.AUDIO_CONTENT_BUFFER_SIZE)
                var noise = Double.MAX_VALUE; var frames = 0; var speech = false; var lastVoice = 0L
                val t0 = System.currentTimeMillis()
                while (flag == 0) {
                    val n = rec.read(buf, 0, buf.size)
                    if (n <= 0) break
                    pcm.write(buf, 0, n)
                    var sum = 0.0; var cnt = 0
                    var i = 0
                    while (i + 1 < n) { val v = (buf[i].toInt() and 0xff) or (buf[i + 1].toInt() shl 8); sum += v.toDouble() * v; cnt++; i += 2 }
                    val rms = if (cnt > 0) sqrt(sum / cnt) else 0.0
                    frames++
                    if (frames <= 12) noise = minOf(noise, rms)
                    val thr = maxOf(350.0, (if (noise == Double.MAX_VALUE) 0.0 else noise) * 3.0)
                    val now = System.currentTimeMillis()
                    if (frames > 4 && rms > thr) { if (!speech) { speech = true; onEvent("speech", null) }; lastVoice = now }
                    if (!speech && now - t0 > 8000) break
                    if (speech && now - lastVoice > 1600) break
                    if (now - t0 > 25000) break
                }
                try { rec.stopRecording() } catch (_: Throwable) {}
                rec = null
                val aborted = flag == 2
                val gotSpeech = speech || (flag == 1 && pcm.size() > 16000)   // selbst beendet: trotzdem auswerten
                onEvent("end", if (aborted || !gotSpeech) null else Base64.encodeToString(wav(pcm.toByteArray(), CarAudioRecord.AUDIO_CONTENT_SAMPLING_RATE), Base64.NO_WRAP))
            } catch (e: Throwable) {
                try { rec?.stopRecording() } catch (_: Throwable) {}
                onEvent("error", e.message ?: e.javaClass.simpleName)
            } finally {
                Handler(Looper.getMainLooper()).postDelayed({ WakeService.setMicBusy(false) }, 400)
            }
        }, "zg-car-rec").start()
    }

    private fun wav(data: ByteArray, rate: Int): ByteArray {
        val out = ByteArrayOutputStream(44 + data.size)
        fun i32(v: Int) { out.write(v and 0xff); out.write((v shr 8) and 0xff); out.write((v shr 16) and 0xff); out.write((v shr 24) and 0xff) }
        fun i16(v: Int) { out.write(v and 0xff); out.write((v shr 8) and 0xff) }
        out.write("RIFF".toByteArray()); i32(36 + data.size); out.write("WAVE".toByteArray())
        out.write("fmt ".toByteArray()); i32(16); i16(1); i16(1); i32(rate); i32(rate * 2); i16(2); i16(16)
        out.write("data".toByteArray()); i32(data.size); out.write(data)
        return out.toByteArray()
    }
}
