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

/**
 * Das „Gehirn“ fürs Auto: die Jarvis-Web-App unsichtbar im Hintergrund (gleiche Daten wie am Handy).
 * Läuft, solange das Handy mit Android Auto verbunden ist (oder der Jarvis-Bildschirm im Auto offen ist).
 * „Hey Jarvis“ landet im Auto hier statt im kleinen Kreis am Handy.
 */
object CarBrain {
    private val main = Handler(Looper.getMainLooper())
    private var web: WebView? = null
    var bridge: NativeBridge? = null
        private set
    /** der gerade offene Jarvis-Bildschirm im Auto (falls offen) */
    var screen: JarvisCarScreen? = null
    /** Anrufe/Navigation übers Auto (kommt vom offenen Auto-Bildschirm oder der Sitzung) */
    var carContext: CarContext? = null
    // letzter Stand für den Bildschirm
    var status = "Sag „Hey Jarvis“ oder tippe auf „Sprechen“."
    var youSaid = ""
    var answer = ""
    val running get() = bridge != null

    fun start(ctx: android.content.Context): Boolean {
        if (bridge != null) return true
        if (Prefs.appUrl(ctx).isBlank()) { status = "Richte Jarvis zuerst einmal in der App am Handy ein."; return false }
        return try {
            val app = ctx.applicationContext
            val w = WebView(app)
            val b = NativeBridge(app, w, mini = false, car = true)
            b.carIntent = { i -> val c = carContext; if (c == null) false else try { c.startCarApp(i); true } catch (_: Throwable) { false } }
            b.carShow = { who, text -> if (who == "du") youSaid = text else answer = text; screen?.refresh() }
            b.carState = { st -> status = if (st == "bereit") "Sag „Hey Jarvis“ oder tippe auf „Sprechen“." else st; screen?.refresh() }
            // Nach einer Rückfrage weiter zuhören: mit dem Auto-Mikrofon, wenn der Bildschirm offen ist, sonst mit dem Handy-Mikrofon
            b.carListen = { val sc = screen; if (sc != null && sc.canRecord()) sc.startListening() else js("window.__zgCarListenPhone && __zgCarListenPhone()") }
            b.setup()
            b.loadStart()
            web = w; bridge = b
            true
        } catch (e: Throwable) { status = "Jarvis konnte im Auto nicht starten: ${e.message ?: "Fehler"}"; false }
    }

    fun stop() {
        if (screen != null) return   // Bildschirm im Auto noch offen
        try { bridge?.destroy() } catch (_: Throwable) {}
        bridge = null; web = null
    }

    /** „Hey Jarvis“ im Auto */
    fun wake() { bridge?.deliverWake() }

    fun js(code: String) { main.post { try { web?.evaluateJavascript(code, null) } catch (_: Throwable) {} } }
}

class JarvisCarScreen(ctx: CarContext) : Screen(ctx) {
    private val main = Handler(Looper.getMainLooper())
    private var recording = false
    private var recorder: CarRecorder? = null
    private var focus: AudioFocusRequest? = null
    private var pendingRefresh = false
    private var visible = false

    init {
        CarBrain.carContext = ctx
        CarBrain.screen = this
        CarBrain.start(ctx)
        lifecycle.addObserver(LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_START -> visible = true
                Lifecycle.Event.ON_STOP -> visible = false
                Lifecycle.Event.ON_DESTROY -> {
                    recorder?.abort(); recorder = null; releaseFocus()
                    if (CarBrain.screen === this) CarBrain.screen = null
                    if (CarBrain.carContext === carContext) CarBrain.carContext = null
                    // Gehirn weiterlaufen lassen, solange das Handy verbunden ist („Hey Jarvis“ im Auto)
                    if (!WakeService.projecting) CarBrain.stop()
                }
                else -> {}
            }
        })
    }

    fun canRecord() = visible && carContext.carAppApiLevel >= 5 && !recording

    /** Anzeige neu zeichnen – gebündelt, damit Android Auto nicht zu oft neu malen muss */
    fun refresh() {
        if (pendingRefresh) return
        pendingRefresh = true
        main.postDelayed({ pendingRefresh = false; try { invalidate() } catch (_: Throwable) {} }, 250)
    }

    private fun onSpeakPressed() {
        if (recording) { recorder?.stop(); return }
        startListening()
    }

    @SuppressLint("MissingPermission")
    fun startListening() {
        if (!CarBrain.running && !CarBrain.start(carContext)) { refresh(); return }
        if (carContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            CarBrain.status = "Jarvis darf das Mikrofon noch nicht benutzen. Öffne einmal die App am Handy und erlaube es."; refresh(); return
        }
        if (carContext.carAppApiLevel < 5) {
            // altes Android Auto: Handy-Mikrofon nehmen
            CarBrain.js("window.__zgCarListenPhone && __zgCarListenPhone()"); return
        }
        CarBrain.js("window.__zgCarHush && __zgCarHush()")   // Jarvis hört auf zu reden
        if (!takeFocus()) { CarBrain.status = "Das Auto-Mikrofon ist gerade belegt."; refresh(); return }
        recording = true; CarBrain.status = "🎙 Ich höre zu …"; CarBrain.youSaid = ""; refresh()
        val r = CarRecorder(carContext) { type, info ->
            main.post {
                when (type) {
                    "speech" -> { CarBrain.status = "🎙 Ich höre zu … (tippe „Sprechen“ zum Beenden)"; refresh() }
                    "end" -> {
                        recording = false; releaseFocus()
                        if (info == null) { CarBrain.status = "Ich habe nichts gehört. Tippe nochmal auf „Sprechen“."; refresh() }
                        else {
                            CarBrain.status = "Versteht …"; refresh()
                            CarBrain.bridge?.carAudio = info
                            CarBrain.js("window.__zgCarAudio && __zgCarAudio()")
                        }
                    }
                    "error" -> { recording = false; releaseFocus(); CarBrain.status = "Mikrofon-Fehler: ${info ?: ""}"; refresh() }
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
        if (!CarBrain.running && !CarBrain.start(carContext)) { refresh(); return }
        CarBrain.youSaid = text; CarBrain.status = "Denkt nach …"; refresh()
        CarBrain.js("window.__zgCarAsk && __zgCarAsk(" + org.json.JSONObject.quote(text) + ")")
    }

    override fun onGetTemplate(): Template {
        val msg = buildString {
            if (CarBrain.youSaid.isNotBlank()) append("Du: ").append(CarBrain.youSaid.take(120)).append("\n\n")
            if (CarBrain.answer.isNotBlank()) append(CarBrain.answer.take(350)).append("\n\n")
            append(CarBrain.status)
        }
        val speak = Action.Builder().setTitle("Sprechen").setFlags(Action.FLAG_PRIMARY)
            .setOnClickListener { onSpeakPressed() }.build()
        val brief = Action.Builder().setTitle("Briefing").setOnClickListener { ask("Guten Morgen") }.build()
        val strip = ActionStrip.Builder()
            .addAction(Action.Builder().setTitle("Musik").setOnClickListener { ask("Spiel die Musik weiter") }.build())
            .addAction(Action.Builder().setTitle("Stopp").setOnClickListener {
                recorder?.abort(); recording = false; releaseFocus()
                CarBrain.js("window.__zgCarHush && __zgCarHush()"); CarBrain.status = "Sag „Hey Jarvis“ oder tippe auf „Sprechen“."; refresh()
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
