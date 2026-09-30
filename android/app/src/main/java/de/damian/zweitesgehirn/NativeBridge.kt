package de.damian.zweitesgehirn

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.app.SearchManager
import android.media.AudioManager
import android.provider.ContactsContract
import android.provider.AlarmClock
import android.provider.MediaStore
import android.view.KeyEvent
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Verbindet eine WebView mit dem, was eine Webseite allein nicht darf:
 * Spracherkennung, Vorlesen, Google-Anmeldung, "Hey Jarvis" und Einstellungen.
 * Wird von der großen App (MainActivity) und vom kleinen Kreis (MiniActivity) benutzt.
 * Die Web-App spricht über das JavaScript-Objekt "ZGAndroid" damit.
 */
class NativeBridge(private val act: android.content.Context, val web: WebView, private val mini: Boolean, private val car: Boolean = false) {
    /** Nur in der App (nicht im Auto) vorhanden */
    private val activity: Activity? get() = act as? Activity
    /** Im Auto: Anrufe/Navigation über Android Auto starten (sonst würde es aufs Handy-Display gehen) */
    var carIntent: ((Intent) -> Boolean)? = null
    /** Im Auto: Text für den Auto-Bildschirm (wer, Text) */
    var carShow: ((String, String) -> Unit)? = null
    /** Im Auto: Sprechen-Knopf-Zustand */
    var carState: ((String) -> Unit)? = null
    var carListen: (() -> Unit)? = null
    @Volatile var carAudio: String? = null

    companion object {
        const val REQ_PERMS = 7
        const val REQ_AUTH = 42
        const val REQ_BANKKEY = 43
        const val BG = "#040b16"
    }

    private val main = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var speech: SpeechRecognizer? = null
    private var srSid = 0
    private var srActiveSid = 0
    private var srEnded = true
    private var pendingWake = false

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    fun setup() {
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            @Suppress("DEPRECATION")
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString ZweitesGehirnApp"
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        web.addJavascriptInterface(js, "ZGAndroid")
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                val app = Uri.parse(Prefs.appUrl(act))
                if (u.scheme == "file" || (u.host != null && u.host == app.host)) return false
                // Links zu anderen Seiten (z. B. Google Kalender) im normalen Browser öffnen
                try { act.startActivity(Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Throwable) {}
                return true
            }
        }
        val googleTts = try { act.packageManager.getPackageInfo("com.google.android.tts", 0); true } catch (_: Throwable) { false }
        val onInit = TextToSpeech.OnInitListener { status ->
            if (destroyed) {
                // Fenster wurde schon geschlossen
            } else if (status == TextToSpeech.SUCCESS) {
                tts?.setLanguage(Locale.GERMANY)
                bestVoice()?.let { tts?.setVoice(it) }
                tts?.setPitch(1.0f)
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(id: String) { emit("__zgTTS", JSONObject().put("type", "start").put("id", id)) }
                    override fun onDone(id: String) { ttsFinished(id, "end") }
                    @Deprecated("alt") override fun onError(id: String) { ttsFinished(id, "error") }
                    override fun onError(id: String, errorCode: Int) { ttsFinished(id, "error") }
                    override fun onStop(id: String, interrupted: Boolean) { ttsFinished(id, "end") }
                })
                main.post {
                    ttsReady = true
                    val q = ArrayList(ttsQueue); ttsQueue.clear(); q.forEach { it() }
                    if (!destroyed) web.evaluateJavascript("window.__zgTTS && __zgTTS.voices()", null)
                }
            } else if (googleTts && !ttsFallbackTried) {
                // Google-Stimme startet nicht: Standard-Stimme des Handys nehmen
                ttsFallbackTried = true
                main.post { try { tts?.shutdown() } catch (_: Throwable) {}; ttsInit?.let { tts = TextToSpeech(act, it) } }
            } else main.post { val q = ArrayList(ttsQueue); ttsQueue.clear(); q.forEach { it() } }   // meldet dann Fehler statt zu hängen
        }
        ttsInit = onInit
        // Die Google-Sprachausgabe klingt meist deutlich natürlicher als die Samsung-Stimme
        tts = if (googleTts) TextToSpeech(act, onInit, "com.google.android.tts") else TextToSpeech(act, onInit)
    }

    /** Beste deutsche Stimme: höchste Qualität, gern die Online-Stimme (klingt am natürlichsten), sonst die beste Offline-Stimme */
    private fun bestVoice(): android.speech.tts.Voice? = try {
        tts?.voices?.filter { it.locale.language == "de" && !it.features.contains("notInstalled") }
            ?.sortedWith(compareByDescending<android.speech.tts.Voice> { it.quality }
                .thenByDescending { it.locale.country == "DE" }
                .thenByDescending { it.isNetworkConnectionRequired })
            ?.firstOrNull()
    } catch (_: Throwable) { null }

    fun loadStart() {
        val url = Prefs.appUrl(act)
        if (url.isBlank()) web.loadUrl("file:///android_asset/setup.html") else web.loadUrl(url)
    }

    fun askPermissions() {
        val need = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) need += Manifest.permission.POST_NOTIFICATIONS
        val missing = need.filter { act.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) activity?.requestPermissions(missing.toTypedArray(), REQ_PERMS)
    }

    /** "Hey Jarvis" wurde gehört: Web-App soll zuhören (oder merkt es sich, falls sie noch lädt). */
    fun deliverWake() {
        pendingWake = true
        main.postDelayed({
            web.evaluateJavascript("(window.__zgWake && __zgWake()) ? 'ok' : 'wait'") { r ->
                if (r?.contains("ok") == true) pendingWake = false
            }
        }, 250)
    }

    /** Widget-Knopf (z. B. Briefing): Satz an die Web-App geben (oder merken, falls sie noch lädt) */
    @Volatile var pendingAsk: String? = null
    fun deliverAsk(text: String) {
        pendingAsk = text
        fun tryIt(n: Int) {
            if (destroyed || pendingAsk == null) return
            web.evaluateJavascript("(window.__zgAsk && __zgAsk(" + JSONObject.quote(text) + ")) ? 'ok' : 'wait'") { r ->
                if (r?.contains("ok") == true) pendingAsk = null
                else if (n < 20) main.postDelayed({ tryIt(n + 1) }, 500)
                else pendingAsk = null   // nach 10 Sekunden verwerfen, nicht später überraschend ausführen
            }
        }
        main.postDelayed({ tryIt(0) }, 600)
    }

    /** Rückkehr von einer Anmeldung im Browser (z. B. SmartThings) an die Web-App geben */
    fun deliverLink(kind: String, code: String, state: String) {
        val o = JSONObject().put("kind", kind).put("code", code).put("state", state)
        fun tryIt(n: Int) {
            if (destroyed) return
            web.evaluateJavascript("(window.__zgLink && __zgLink($o)) ? 'ok' : 'wait'") { r ->
                if (r?.contains("ok") != true && n < 30) main.postDelayed({ tryIt(n + 1) }, 500)
            }
        }
        main.postDelayed({ tryIt(0) }, 400)
    }

    @Volatile var pendingDiary = false
    fun deliverDiary() {
        pendingDiary = true
        main.postDelayed({
            web.evaluateJavascript("(window.__zgDiary && __zgDiary()) ? 'ok' : 'wait'") { r -> if (r?.contains("ok") == true) pendingDiary = false }
        }, 400)
    }

    fun onResume() { web.evaluateJavascript("window.__zgResume && __zgResume()", null) }
    fun onWakeStopped() { main.post { web.evaluateJavascript("window.__zgWakeState && __zgWakeState(false)", null) } }
    fun isListening(): Boolean = !srEnded || recorder.active

    private val recorder: VoiceRecorder by lazy { VoiceRecorder { type, sid, extra ->
        emit("__zgRec", JSONObject().put("type", type).put("sid", sid).put("info", extra ?: ""))
        if (type == "end" || type == "error") main.postDelayed({ if (srEnded && !recorder.active && tts?.isSpeaking != true) releaseFocus() }, 500)
    } }
    @Volatile private var ttsReady = false
    private var ttsFallbackTried = false
    private var ttsInit: TextToSpeech.OnInitListener? = null
    private val ttsQueue = ArrayList<() -> Unit>()
    @Volatile private var destroyed = false
    fun destroy() {
        destroyed = true
        releaseFocus()
        try { recorder.abortAll() } catch (_: Throwable) {}
        srEnded = true
        main.removeCallbacksAndMessages(null)
        try { speech?.destroy() } catch (_: Throwable) {}; speech = null
        try { tts?.stop(); tts?.shutdown() } catch (_: Throwable) {}; tts = null
        WakeService.setMicBusy(false); WakeService.setSpeaking(false)
        try { web.removeJavascriptInterface("ZGAndroid"); web.stopLoading(); web.destroy() } catch (_: Throwable) {}
    }

    /** Laufende Erkennung sauber beenden (cancel/destroy melden sonst nie „Ende“ an die Web-App) */
    private fun endActive() {
        if (!srEnded) {
            srEnded = true
            emit("__zgSR", JSONObject().put("type", "end").put("sid", srActiveSid))
            main.postDelayed({ if (srEnded && !recorder.active) { WakeService.setMicBusy(false); if (tts?.isSpeaking != true) releaseFocus() } }, 400)
        }
    }

    // ---------- Hilfen ----------
    private fun emit(target: String, obj: JSONObject) {
        if (destroyed) return
        val code = "window.$target && $target.emit($obj)"
        main.post { if (!destroyed) try { web.evaluateJavascript(code, null) } catch (_: Throwable) {} }
    }

    private fun ttsFinished(id: String, type: String) {
        emit("__zgTTS", JSONObject().put("type", type).put("id", id))
        main.postDelayed({ if (tts?.isSpeaking != true) { WakeService.setSpeaking(false); if (srEnded) releaseFocus() } }, 400)
    }

    // Im Auto: Musik leiser machen, solange Jarvis spricht
    private var focusReq: android.media.AudioFocusRequest? = null
    private val speechAttrs = android.media.AudioAttributes.Builder()
        .setUsage(android.media.AudioAttributes.USAGE_ASSISTANT)
        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build()
    private fun takeFocus() {
        if (focusReq != null) return
        try {
            val req = android.media.AudioFocusRequest.Builder(android.media.AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(speechAttrs).build()
            act.getSystemService(android.media.AudioManager::class.java).requestAudioFocus(req)
            focusReq = req
        } catch (_: Throwable) {}
    }
    private fun releaseFocus() {
        val r = focusReq ?: return
        focusReq = null
        try { act.getSystemService(android.media.AudioManager::class.java).abandonAudioFocusRequest(r) } catch (_: Throwable) {}
    }

    // ---------- Spracherkennung ----------
    private fun startRecognition(sid: Int, lang: String, interim: Boolean) {
        WakeService.setMicBusy(true)
        takeFocus()   // Musik leiser, damit Jarvis dich versteht
        endActive()
        try { speech?.destroy() } catch (_: Throwable) {}
        srActiveSid = sid
        srEnded = false
        fun endSession() {
            if (srActiveSid != sid || srEnded) return
            srEnded = true
            emit("__zgSR", JSONObject().put("type", "end").put("sid", sid))
            main.postDelayed({ if (srEnded && !recorder.active) { WakeService.setMicBusy(false); if (tts?.isSpeaking != true) releaseFocus() } }, 400)
        }
        if (!SpeechRecognizer.isRecognitionAvailable(act)) {
            emit("__zgSR", JSONObject().put("type", "error").put("sid", sid).put("error", "service-not-allowed"))
            endSession(); return
        }
        val sr = recognizerComponent()?.let { SpeechRecognizer.createSpeechRecognizer(act, it) } ?: SpeechRecognizer.createSpeechRecognizer(act)
        speech = sr
        sr.setRecognitionListener(object : RecognitionListener {
            private fun text(b: android.os.Bundle?): String? = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            private fun alts(b: android.os.Bundle?): JSONArray = JSONArray((b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION) ?: arrayListOf<String>()).take(5))
            override fun onPartialResults(b: android.os.Bundle?) {
                val t = text(b) ?: return
                if (t.isNotBlank()) emit("__zgSR", JSONObject().put("type", "result").put("sid", sid).put("text", t).put("final", false))
            }
            override fun onResults(b: android.os.Bundle?) {
                val t = text(b)
                if (!t.isNullOrBlank()) emit("__zgSR", JSONObject().put("type", "result").put("sid", sid).put("text", t).put("final", true).put("alts", alts(b)))
                endSession()
            }
            override fun onError(error: Int) {
                val e = when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "not-allowed"
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
                    SpeechRecognizer.ERROR_AUDIO -> "audio-capture"
                    else -> "aborted"
                }
                emit("__zgSR", JSONObject().put("type", "error").put("sid", sid).put("error", e))
                endSession()
            }
            override fun onReadyForSpeech(p: android.os.Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(v: Float) {}
            override fun onBufferReceived(b: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(t: Int, p: android.os.Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, interim)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, act.packageName)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false)                 // Online-Erkennung ist genauer
            // nicht zu früh abschneiden, wenn man kurz überlegt
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1800L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1500L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 1500L)
            if (Build.VERSION.SDK_INT >= 33) {
                putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY)
                // Wörter, die Jarvis oft hört – die Erkennung versteht sie dann besser
                putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, arrayListOf(
                    "Jarvis", "Hey Jarvis", "Spotify", "WhatsApp", "Phantom Wallet", "Wallet", "Alexa", "Tagebuch", "Einkaufsliste",
                    "To-do", "SPS", "Sparkasse", "Fixkosten", "Budget", "Briefing", "Gzuz", "Solana", "Wecker", "Timer", "Berufsschule",
                    "Elektrotechnik", "Automatisierungstechnik", "Stundenplan", "Kontostand", "Guthaben", "Haßfurt", "Schweinfurt"))
            }
        }
        // kurz warten, damit der Hintergrund-Dienst das Mikrofon sicher freigegeben hat
        main.postDelayed({ if (!destroyed && srActiveSid == sid && !srEnded) try { sr.startListening(intent) } catch (_: Throwable) { endSession() } }, 180)
    }

    /** Google-Spracherkennung bevorzugen (Samsung nimmt sonst oft die eigene, schlechtere) */
    private fun recognizerComponent(): android.content.ComponentName? = try {
        val services = act.packageManager.queryIntentServices(Intent(android.speech.RecognitionService.SERVICE_INTERFACE), 0)
        val pick = services.firstOrNull { it.serviceInfo.packageName == "com.google.android.googlequicksearchbox" }
            ?: services.firstOrNull { it.serviceInfo.packageName == "com.google.android.tts" }
            ?: services.firstOrNull { it.serviceInfo.packageName.startsWith("com.google") }
        pick?.let { android.content.ComponentName(it.serviceInfo.packageName, it.serviceInfo.name) }
    } catch (_: Throwable) { null }

    // ---------- Google-Anmeldung (für Kalender, Gmail, Kontakte, Drive) ----------
    private fun requestGoogle(scopes: String, silent: Boolean) {
        val req = AuthorizationRequest.builder()
            .setRequestedScopes(scopes.split(" ").filter { it.isNotBlank() }.map { Scope(it) })
            .build()
        Identity.getAuthorizationClient(act).authorize(req)
            .addOnSuccessListener { res ->
                if (res.hasResolution()) {
                    if (silent) { googleResult(null, "needs-ui"); return@addOnSuccessListener }
                    try {
                        @Suppress("DEPRECATION")
                        val a = activity ?: run { googleResult(null, "Öffne die App am Handy, um Google zu verbinden"); return@addOnSuccessListener }
                        a.startIntentSenderForResult(res.pendingIntent!!.intentSender, REQ_AUTH, null, 0, 0, 0)
                    } catch (e: Throwable) { googleResult(null, e.message ?: "Anmeldung konnte nicht starten") }
                } else googleResult(res.accessToken, null)
            }
            .addOnFailureListener { e -> googleResult(null, e.message ?: "Google-Anmeldung fehlgeschlagen") }
    }

    /** Muss von der Activity aus onActivityResult aufgerufen werden. */
    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_BANKKEY) {
            val uri = data?.data
            if (resultCode != Activity.RESULT_OK || uri == null) { emit("__zgBank", JSONObject().put("type", "key").put("ok", false).put("msg", "Keine Datei gewählt")); return }
            val pem = try { act.contentResolver.openInputStream(uri)?.bufferedReader()?.readText() ?: "" } catch (_: Throwable) { "" }
            val e = BankApi.setKey(act, pem)
            emit("__zgBank", JSONObject().put("type", "key").put("ok", e == null).put("msg", e ?: "Schlüssel gespeichert"))
            return
        }
        if (requestCode != REQ_AUTH) return
        try {
            val res = Identity.getAuthorizationClient(act).getAuthorizationResultFromIntent(data)
            googleResult(res.accessToken, null)
        } catch (e: Throwable) {
            googleResult(null, if (resultCode == Activity.RESULT_CANCELED) "Anmeldung abgebrochen" else (e.message ?: "Anmeldung fehlgeschlagen"))
        }
    }

    private fun googleResult(token: String?, error: String?) {
        val o = JSONObject()
        if (!token.isNullOrBlank()) o.put("token", token) else o.put("error", error ?: "Kein Zugriff erhalten")
        emit("__zgGoogle", o)
    }

    /** Alles, was die Web-App aufrufen darf */
    val js by lazy { Js() }

    inner class Js {
        @JavascriptInterface fun version(): String =
            try { act.packageManager.getPackageInfo(act.packageName, 0).versionName ?: "" } catch (_: Throwable) { "" }
        @JavascriptInterface fun isMini(): Boolean = mini

        // Sicherheit: Tresor für Schlüssel, App-Sperre, Sperrbildschirm-Erkennung
        private fun okName(n: String) = n.length in 3..40 && n.startsWith("zg_") && n.all { it.isLetterOrDigit() || it == '_' }
        @JavascriptInterface fun secretGet(name: String): String = if (okName(name)) Secure.vaultGet(act, name) else ""
        @JavascriptInterface fun secretSet(name: String, value: String) { if (okName(name) && value.length < 4000) Secure.vaultSet(act, name, value) }
        // Jarvis meldet sich von selbst (Geburtstage, Arbeiten, Budget)
        @JavascriptInterface fun proactiveSync(json: String) { if (json.length < 100_000) Proactive.sync(act, json) }
        @JavascriptInterface fun deviceLocked(): Boolean = try { MainActivity.privateLocked(act) } catch (_: Throwable) { false }
        @JavascriptInterface fun appLockGet(): Boolean = Prefs.appLock(act)
        /** Rückgabe: "ok" oder ein Grund, warum es nicht geht */
        @JavascriptInterface fun appLockSet(on: Boolean): String {
            if (on && !(try { act.getSystemService(android.app.KeyguardManager::class.java).isDeviceSecure } catch (_: Throwable) { false }))
                return "Auf deinem Handy ist keine Bildschirmsperre eingerichtet. Richte zuerst PIN oder Fingerabdruck ein."
            if (on) { Prefs.setAppLock(act, true); main.post { (act as? MainActivity)?.markUnlocked() }; return "ok" }
            if (!Prefs.appLock(act)) return "ok"
            // Ausschalten nur nach Fingerabdruck/PIN (und nicht im kleinen Kreis)
            val m = act as? MainActivity ?: return "Öffne dafür die große App."
            main.post { m.confirmThen { Prefs.setAppLock(act, false); if (!destroyed) web.evaluateJavascript("window.__zgLockChanged && __zgLockChanged()", null) } }
            return "auth"
        }

        // Spracherkennung
        @JavascriptInterface fun srStart(lang: String, interim: Boolean): Int {
            val sid = ++srSid
            main.post { startRecognition(sid, lang, interim) }
            return sid
        }
        @JavascriptInterface fun srStop(sid: Int) { main.post { if (sid == srActiveSid) speech?.stopListening() } }
        @JavascriptInterface fun srAbort(sid: Int) {
            main.post {
                if (sid != srActiveSid || srEnded) return@post
                try { speech?.cancel() } catch (_: Throwable) {}
                emit("__zgSR", JSONObject().put("type", "error").put("sid", sid).put("error", "aborted"))
                srEnded = true
                emit("__zgSR", JSONObject().put("type", "end").put("sid", sid))
                main.postDelayed({ if (srEnded && !recorder.active) { WakeService.setMicBusy(false); if (tts?.isSpeaking != true) releaseFocus() } }, 400)
            }
        }

        // Vorlesen
        @JavascriptInterface fun ttsSpeak(id: String, text: String, voice: String, rate: Float) {
            main.post {
                val job: () -> Unit = {
                    val t = tts
                    if (t == null) emit("__zgTTS", JSONObject().put("type", "error").put("id", id))
                    else {
                        try {
                            val v = if (voice.isNotBlank()) t.voices?.firstOrNull { it.name == voice } else null
                            (v ?: bestVoice())?.let { if (t.voice?.name != it.name) t.setVoice(it) }
                        } catch (_: Throwable) {}
                        t.setSpeechRate(rate)
                        try { t.setAudioAttributes(speechAttrs) } catch (_: Throwable) {}; takeFocus()   // Musik leiser, solange Jarvis spricht
                        WakeService.setSpeaking(true)
                        val r = t.speak(text, TextToSpeech.QUEUE_ADD, null, id)
                        if (r != TextToSpeech.SUCCESS) { WakeService.setSpeaking(false); emit("__zgTTS", JSONObject().put("type", "error").put("id", id)) }
                    }
                }
                if (ttsReady) job() else {
                    // Stimme startet noch: kurz merken; kommt sie nicht, Fehler melden (Web-App wartet sonst ewig)
                    ttsQueue.add(job)
                    main.postDelayed({ if (!ttsReady && ttsQueue.remove(job)) emit("__zgTTS", JSONObject().put("type", "error").put("id", id)) }, 4000)
                }
            }
        }
        @JavascriptInterface fun ttsEngine(): String = try { tts?.defaultEngine ?: "" } catch (_: Throwable) { "" }
        @JavascriptInterface fun ttsCancel() { main.post { tts?.stop(); main.postDelayed({ WakeService.setSpeaking(false); if (srEnded) releaseFocus() }, 300) } }
        @JavascriptInterface fun ttsVoices(): String {
            val arr = JSONArray()
            try {
                tts?.voices?.filter { it.locale.language == "de" && !it.features.contains("notInstalled") }
                    ?.sortedWith(compareByDescending<android.speech.tts.Voice> { it.quality }.thenByDescending { it.isNetworkConnectionRequired })?.forEach {
                    arr.put(JSONObject().put("name", it.name).put("lang", it.locale.toLanguageTag()).put("online", it.isNetworkConnectionRequired).put("quality", it.quality))
                }
            } catch (_: Throwable) {}
            return arr.toString()
        }

        // Google
        @JavascriptInterface fun googleToken(scopes: String) { main.post { requestGoogle(scopes, false) } }
        @JavascriptInterface fun googleTokenSilent(scopes: String) { main.post { requestGoogle(scopes, true) } }

        // "Hey Jarvis"
        @JavascriptInterface fun wakeSet(on: Boolean) {
            main.post {
                Prefs.setWake(act, on)
                if (on) { askPermissions(); WakeService.start(act) } else WakeService.stop(act)
            }
        }
        @JavascriptInterface fun wakeOn(): Boolean = Prefs.wake(act)
        // Genaue KI-Erkennung: Aufnahme bis zur Sprechpause, die Web-App schickt sie an Gemini
        @JavascriptInterface fun recStart(pauseMs: Int, maxMs: Int): Int {
            main.post { if (!srEnded) { try { speech?.cancel() } catch (_: Throwable) {}; endActive() }; takeFocus() }
            return recorder.start(pauseMs, maxMs)
        }
        @JavascriptInterface fun recStop(sid: Int) { recorder.stop(sid) }
        @JavascriptInterface fun recAbort(sid: Int) { recorder.abort(sid) }
        @JavascriptInterface fun recTake(sid: Int): String = recorder.take(sid)
        @JavascriptInterface fun bargeInGet(): Boolean = Prefs.bargeIn(act)
        @JavascriptInterface fun bargeInSet(on: Boolean) { Prefs.setBargeIn(act, on); WakeService.bargeIn = on }
        /** Für die KI-Stimme (spielt in der Web-App): Hintergrund-Dienst wissen lassen, dass Jarvis spricht */
        @JavascriptInterface fun setSpeaking(on: Boolean) { WakeService.setWebSpeaking(on) }
        @JavascriptInterface fun consumeWake(): Boolean { val w = pendingWake; pendingWake = false; return w }
        @JavascriptInterface fun wakeScore(): Float = WakeService.lastScore

        // kleiner Kreis
        @JavascriptInterface fun miniClose() { main.post { if (mini) activity?.finish() } }
        @JavascriptInterface fun openFullApp() {
            main.post {
                try { act.startActivity(Intent(act, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Throwable) {}
                if (mini) activity?.finish()
            }
        }

        // Einrichtung
        @JavascriptInterface fun getAppUrl(): String = Prefs.appUrl(act)
        @JavascriptInterface fun setAppUrl(url: String) {
            val u = url.trim()
            if (!u.startsWith("https://")) return      // nur sichere Adressen (kein http)
            Prefs.setAppUrl(act, u)
            main.post { loadStart() }
        }
        @JavascriptInterface fun openSetup() { main.post { web.loadUrl("file:///android_asset/setup.html") } }
        @JavascriptInterface fun openApp() { main.post { loadStart() } }
        @JavascriptInterface fun overlayGranted(): Boolean = Settings.canDrawOverlays(act)
        @JavascriptInterface fun openOverlaySettings() {
            main.post { try { act.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${act.packageName}"))) } catch (_: Throwable) {} }
        }
        @JavascriptInterface fun batteryOk(): Boolean =
            act.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(act.packageName)
        @SuppressLint("BatteryLife")
        @JavascriptInterface fun openBatterySettings() {
            main.post {
                try { act.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${act.packageName}"))) }
                catch (_: Throwable) { try { act.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) } catch (_: Throwable) {} }
            }
        }
        // Musik: Spotify starten und steuern
        /** Startet Spotify mit einer Suche (Künstler, Lied, Playlist). false = Spotify nicht installiert. */
        @JavascriptInterface fun spotifyPlay(query: String, artist: String): Boolean {
            val app = act.applicationContext
            val installed = Music.spotifyInstalled(app)
            val wasBig = !mini
            main.post {
                WakeService.setMicBusy(false)
                try { speech?.cancel() } catch (_: Throwable) {}; endActive()
                // erst im Hintergrund versuchen, nur wenn das nicht geht kurz über Spotify
                Music.play(app, query, artist, wasBig) { ok, how, msg ->
                    emit("__zgMusic", JSONObject().put("ok", ok).put("how", how).put("msg", msg)
                        .put("access", Music.accessGranted(app)).put("log", Music.lastLog))
                }
            }
            return installed
        }
        @JavascriptInterface fun spotifyPlaylist(name: String): Boolean {
            val app = act.applicationContext; val wasBig = !mini
            main.post {
                WakeService.setMicBusy(false)
                try { speech?.cancel() } catch (_: Throwable) {}; endActive()
                Music.playPlaylist(app, name, wasBig) { ok, how, msg ->
                    emit("__zgMusic", JSONObject().put("ok", ok).put("how", how).put("msg", msg)
                        .put("access", Music.accessGranted(app)).put("log", Music.lastLog))
                }
            }
            return Music.spotifyInstalled(app)
        }
        // Spotify-Schnittstelle (Premium): einmal anmelden, dann spielt alles im Hintergrund
        @JavascriptInterface fun spotifyApiState(): String = JSONObject()
            .put("clientId", SpotifyApi.clientId(act)).put("connected", SpotifyApi.connected(act))
            .put("redirect", SpotifyApi.REDIRECT).toString()
        @JavascriptInterface fun spotifyConnect(clientId: String): Boolean {
            if (clientId.isNotBlank()) SpotifyApi.setClientId(act, clientId)
            return SpotifyApi.startLogin(act)
        }
        @JavascriptInterface fun spotifyDisconnect() { SpotifyApi.disconnect(act) }
        fun spotifyRedirect(uri: android.net.Uri) {
            Thread {
                val (ok, msg) = try { SpotifyApi.handleRedirect(act, uri) } catch (e: Throwable) { false to (e.message ?: "Fehler") }
                main.post { web.loadUrl("file:///android_asset/setup.html#spotify=" + (if (ok) "ok" else "fehler") + "&msg=" + android.net.Uri.encode(msg)) }
            }.start()
        }
        // WhatsApp: Chat mit fertigem Text öffnen, mit Bedienungshilfe automatisch senden
        @JavascriptInterface fun whatsappReady(): Boolean = WhatsApp.installedPackage(act) != null
        @JavascriptInterface fun whatsappAuto(): Boolean = WhatsApp.autoSendEnabled(act)
        @JavascriptInterface fun openWhatsappAuto() { main.post { WhatsApp.openAutoSendSettings(act) } }
        @JavascriptInterface fun whatsappSend(number: String, text: String): Boolean {
            val app = act.applicationContext; val big = !mini
            var r = false
            main.post {
                WakeService.setMicBusy(false); try { speech?.cancel() } catch (_: Throwable) {}; endActive()
                r = WhatsApp.send(app, number, text, big) { ok, msg ->
                    emit("__zgWa", JSONObject().put("ok", ok).put("msg", msg).put("auto", WhatsApp.autoSendEnabled(app)))
                }
            }
            return WhatsApp.installedPackage(act) != null
        }
        // Bankkonto (Enable Banking, nur lesen)
        @JavascriptInterface fun bankState(): String = JSONObject()
            .put("appId", BankApi.appId(act)).put("hasKey", BankApi.hasKey(act)).put("bank", BankApi.bankName(act))
            .put("connected", BankApi.connected(act)).put("validUntil", BankApi.validUntil(act)).put("redirect", BankApi.REDIRECT).toString()
        @JavascriptInterface fun bankSetAppId(id: String) { BankApi.setAppId(act, id) }
        @JavascriptInterface fun bankPickKey() {
            main.post {
                val i = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                try { activity?.startActivityForResult(i, REQ_BANKKEY) } catch (_: Throwable) {}
            }
        }
        @JavascriptInterface fun bankSearch(q: String) {
            Thread { emit("__zgBank", BankApi.searchBanks(act, q).put("type", "banks")) }.start()
        }
        @JavascriptInterface fun bankConnect(name: String) {
            Thread {
                val e = try { BankApi.startAuth(act, name) } catch (x: Throwable) { x.message ?: "Fehler" }
                emit("__zgBank", JSONObject().put("type", "auth").put("ok", e == null).put("msg", e ?: "Browser geht auf – bei der Sparkasse anmelden und freigeben."))
            }.start()
        }
        @JavascriptInterface fun bankFetch() {
            Thread {
                val r = try { BankApi.fetch(act) } catch (x: Throwable) { JSONObject().put("ok", false).put("error", x.message ?: "Fehler") }
                emit("__zgBank", JSONObject().put("type", "data").put("data", r))
            }.start()
        }
        @JavascriptInterface fun bankCached(): String = BankApi.cached(act)
        @JavascriptInterface fun bankDisconnect() { BankApi.disconnect(act) }
        fun bankRedirect(uri: android.net.Uri) {
            Thread {
                val (ok, msg) = try { BankApi.handleRedirect(act, uri) } catch (e: Throwable) { false to (e.message ?: "Fehler") }
                main.post { web.loadUrl("file:///android_asset/setup.html#bank=" + (if (ok) "ok" else "fehler") + "&msg=" + android.net.Uri.encode(msg)) }
            }.start()
        }
        // Erinnerungen, Kurs-Alarm, Timer, Navigation
        @JavascriptInterface fun reminderAdd(at: String, text: String): Int = at.toLongOrNull()?.let { Reminders.add(act, it, text) } ?: -1
        @JavascriptInterface fun reminderList(): String = Reminders.list(act).toString()
        @JavascriptInterface fun reminderCancel(id: Int) { Reminders.cancel(act, id) }
        @JavascriptInterface fun priceAlertAdd(coin: String, sym: String, below: Boolean, price: String, cur: String): Int =
            price.replace(',', '.').toDoubleOrNull()?.let { PriceAlerts.add(act, coin, sym, below, it, cur) } ?: -1
        @JavascriptInterface fun priceAlertList(): String = PriceAlerts.list(act).toString()
        @JavascriptInterface fun priceAlertCancel(id: Int) { PriceAlerts.cancel(act, id) }
        @JavascriptInterface fun timer(seconds: Int, label: String) { main.post { Phone.timer(act, seconds, label) } }
        @JavascriptInterface fun maps(dest: String, mode: String, start: Boolean) {
            main.post {
                // Im Auto: Navigation direkt auf dem Auto-Bildschirm starten
                val viaCar = carIntent?.let { f -> try { f(Intent("androidx.car.app.action.NAVIGATE", Uri.parse("geo:0,0?q=" + Uri.encode(dest)))) } catch (_: Throwable) { false } } ?: false
                if (!viaCar) Phone.maps(act, dest, mode, start)
            }
        }
        // Auto (Android Auto)
        @JavascriptInterface fun isCar(): Boolean = car
        // Amazon (nur Warenkorb, nie kaufen), Zwischenablage, Links, Preis-Wächter
        @JavascriptInterface fun amazonInstalled(): Boolean = Amazon.installed(act)
        @JavascriptInterface fun amazonCart(asin: String, qty: Int) {
            main.post { Amazon.addToCart(act, asin, qty) { ok, msg -> emit("__zgShop", JSONObject().put("type", "cart").put("ok", ok).put("msg", msg)) } }
        }
        // ---------- Neue Dienste (Untis, Müll, Tanken, News, DHL, SmartThings …) ----------
        /** Internet-Anfrage an einen erlaubten Dienst; Antwort als __zgNet-Ereignis {id, status, body} */
        @JavascriptInterface fun http(id: String, method: String, url: String, headers: String, body: String) {
            Thread { emit("__zgNet", Net.forWeb(url, method, headers, body).put("id", id)) }.start()
        }
        @JavascriptInterface fun untisReady(): Boolean = Untis.creds(act) != null
        @JavascriptInterface fun untisRange(id: String, from: Int, to: Int) { Thread { emit("__zgNet", Untis.range(act, from, to).put("id", id)) }.start() }
        @JavascriptInterface fun untisSearch(id: String, q: String) { Thread { emit("__zgNet", Untis.search(q.take(80)).put("id", id)) }.start() }
        // Samsung Health / Health Connect
        @JavascriptInterface fun healthState(): String = if (!Health.available()) "old" else if (Health.granted(act)) "ok" else "perm"
        @JavascriptInterface fun healthConnect() { main.post { if (Health.available()) activity?.requestPermissions(Health.PERMS, REQ_PERMS + 20) } }
        @JavascriptInterface fun healthToday(id: String) { Health.today(act) { emit("__zgNet", it.put("id", id)) } }
        // Handy
        @JavascriptInterface fun torch(on: Boolean): String = Phone.torch(act, on)
        @JavascriptInterface fun dnd(on: Boolean): String = Phone.dnd(act, on)
        @JavascriptInterface fun ringer(mode: String): String = Phone.ringer(act, mode)
        @JavascriptInterface fun battery(): String = try { Phone.battery(act).toString() } catch (_: Throwable) { "{}" }
        // Standort + Orts-Erinnerungen
        @JavascriptInterface fun locState(): String = if (!Loc.has(act)) "none" else if (Build.VERSION.SDK_INT >= 29 && !Loc.hasBackground(act)) "fg" else "bg"
        @JavascriptInterface fun locPerm(background: Boolean) {
            main.post {
                val a = activity ?: return@post
                if (!background || !Loc.has(act)) a.requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), REQ_PERMS + 21)
                else if (Build.VERSION.SDK_INT >= 29) a.requestPermissions(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION), REQ_PERMS + 22)
            }
        }
        @JavascriptInterface fun locNow(id: String) { main.post { Loc.current(act) { emit("__zgNet", it.put("id", id)) } } }
        @JavascriptInterface fun placeAdd(text: String, place: String, spots: String, radius: Float): String =
            try { Places.add(act, text.take(200), place.take(80), JSONArray(spots), radius) } catch (e: Throwable) { e.message ?: "Fehler" }
        @JavascriptInterface fun placeList(): String = Places.list(act).toString()
        @JavascriptInterface fun placeRemove(id: String) { Places.remove(act, id) }
        // Tank-Alarm
        @JavascriptInterface fun fuelWatchSet(limit: Double, type: String, lat: Double, lng: Double) { FuelWatch.set(act, limit, type, lat, lng) }
        @JavascriptInterface fun fuelWatchGet(): String = FuelWatch.get(act)?.toString() ?: ""
        @JavascriptInterface fun fuelWatchClear() { FuelWatch.clear(act) }
        @JavascriptInterface fun amazonSearch(q: String) { main.post { Amazon.search(act, q) } }
        /** Produkt auf amazon.de suchen (ohne Gemini); Antwort kommt als __zgShop-Ereignis „find“ */
        @JavascriptInterface fun amazonFind(q: String, id: String) {
            Thread {
                val r = try { AmazonWeb.search(q.take(120)) } catch (_: Throwable) { JSONObject().put("ok", false).put("msg", "Fehler") }
                emit("__zgShop", r.put("type", "find").put("id", id))
            }.start()
        }
        @JavascriptInterface fun amazonProduct(asin: String) { main.post { Amazon.product(act, asin) } }
        @JavascriptInterface fun copyText(text: String) { main.post { Share.copy(act, "Jarvis", text) } }
        @JavascriptInterface fun openLink(url: String, pkg: String) { main.post { Share.open(act, url, pkg) } }
        @JavascriptInterface fun priceWatchAdd(asin: String, name: String, limit: String, now: String): Int =
            limit.replace(',', '.').toDoubleOrNull()?.let { PriceWatch.add(act, asin, name, it, now.replace(',', '.').toDoubleOrNull() ?: 0.0) } ?: -1
        @JavascriptInterface fun priceWatchList(): String = PriceWatch.list(act).toString()
        @JavascriptInterface fun priceWatchCancel(id: Int) { PriceWatch.cancel(act, id) }
        @JavascriptInterface fun priceWatchModel(model: String) { PriceWatch.setModel(act, model) }
        /** Aufnahme aus dem Auto-Mikrofon abholen (einmal) */
        @JavascriptInterface fun carTake(): String { val a = carAudio ?: ""; carAudio = null; return a }
        /** Nach einer Rückfrage (z. B. „Soll ich eintragen?“) gleich wieder zuhören */
        @JavascriptInterface fun carListen() { main.post { carListen?.invoke() } }
        @JavascriptInterface fun carShow(who: String, text: String) { main.post { carShow?.invoke(who, text) } }
        @JavascriptInterface fun carState(state: String) { main.post { carState?.invoke(state) } }

        // Tagebuch
        @JavascriptInterface fun consumeDiary(): Boolean { val d = pendingDiary; pendingDiary = false; return d }
        @JavascriptInterface fun consumeAsk(): String { val a = pendingAsk ?: ""; pendingAsk = null; return a }
        @JavascriptInterface fun diaryReminder(h: Int, m: Int) { DiaryReminder.set(act, h, m) }
        @JavascriptInterface fun diaryReminderTime(): String = DiaryReminder.time(act)?.let { "%02d:%02d".format(it.first, it.second) } ?: ""
        /** Protokoll des letzten Abspielversuchs (für die Einstellungsseite) */
        @JavascriptInterface fun musicLog(): String = Music.lastLog
        /** Steuert die gerade laufende Musik (Spotify oder jede andere App), ohne sie zu öffnen. */
        @JavascriptInterface fun mediaLog(): String = Music.controlLog
        @JavascriptInterface fun media(cmd: String) {
            main.post {
                val am = act.getSystemService(AudioManager::class.java)
                when (cmd) {
                    "louder", "quieter" -> {
                        releaseFocus()   // Musik nicht mehr „geduckt“, sonst hört man die Änderung nicht
                        val before = am.getStreamVolume(AudioManager.STREAM_MUSIC)
                        val dir = if (cmd == "louder") AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER
                        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, dir, AudioManager.FLAG_SHOW_UI)
                        am.adjustStreamVolume(AudioManager.STREAM_MUSIC, dir, 0)
                        val after = am.getStreamVolume(AudioManager.STREAM_MUSIC)
                        Music.controlLog = "Befehl: $cmd\nLautstärke: $before → $after von ${am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)}" +
                            (if (before == after) "\n✗ hat sich nicht geändert (am Anschlag oder vom Gerät gesperrt)" else "\n✓ geändert")
                    }
                    else -> Music.control(act.applicationContext, cmd)
                }
            }
        }
        /** Benachrichtigungszugriff: nötig, damit Musik ohne Öffnen von Spotify startet */
        @JavascriptInterface fun musicAccess(): Boolean = Music.accessGranted(act)
        @JavascriptInterface fun openMusicAccess() { main.post { Music.openAccessSettings(act) } }

        // Alexa über Voice Monkey + Wecker
        @JavascriptInterface fun alexaReady(): Boolean = AlexaAlarm.configured(act)
        @JavascriptInterface fun alexaSetup(token: String, device: String) { AlexaAlarm.configure(act, token, device) }
        @JavascriptInterface fun alexaDevice(): String = AlexaAlarm.device(act)
        @JavascriptInterface fun alexaTest() {
            Thread {
                val (ok, msg) = AlexaAlarm.trigger(act)
                emit("__zgAlexa", JSONObject().put("ok", ok).put("msg", msg))
            }.start()
        }
        /** at = Zeitpunkt in Millisekunden (als Text, weil JavaScript-Zahlen zu groß für Int sind) */
        @JavascriptInterface fun alexaAlarm(at: String, label: String): Int = at.toLongOrNull()?.let { AlexaAlarm.schedule(act, it, label) } ?: -1
        @JavascriptInterface fun alexaAlarms(): String = AlexaAlarm.list(act).toString()
        @JavascriptInterface fun alexaCancel(id: Int) { AlexaAlarm.cancel(act, id) }
        /** Wecker in der Uhr-App des Handys stellen, ohne sie zu öffnen */
        @JavascriptInterface fun phoneAlarm(hour: Int, minute: Int, label: String) {
            main.post {
                val i = Intent(AlarmClock.ACTION_SET_ALARM)
                    .putExtra(AlarmClock.EXTRA_HOUR, hour).putExtra(AlarmClock.EXTRA_MINUTES, minute)
                    .putExtra(AlarmClock.EXTRA_MESSAGE, label).putExtra(AlarmClock.EXTRA_SKIP_UI, true)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { act.startActivity(i) } catch (_: Throwable) {}
            }
        }

        // Anrufen
        @JavascriptInterface fun phoneReady(): Boolean =
            act.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED &&
            act.checkSelfPermission(Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED
        @JavascriptInterface fun requestPhone() {
            main.post { activity?.requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS, Manifest.permission.CALL_PHONE), REQ_PERMS) }
        }
        /** Sucht Kontakte mit Telefonnummer, deren Name den Suchbegriff enthält. */
        @JavascriptInterface fun findContacts(query: String): String {
            val out = JSONArray()
            if (act.checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return out.toString()
            val cols = arrayOf(
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER,
                ContactsContract.CommonDataKinds.Phone.TYPE,
                ContactsContract.CommonDataKinds.Phone.IS_SUPER_PRIMARY,
            )
            try {
                act.contentResolver.query(
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI, cols,
                    "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ?", arrayOf("%$query%"),
                    "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC"
                )?.use { c ->
                    while (c.moveToNext() && out.length() < 20) {
                        out.put(JSONObject()
                            .put("name", c.getString(0) ?: "")
                            .put("number", c.getString(1) ?: "")
                            .put("mobile", c.getInt(2) == ContactsContract.CommonDataKinds.Phone.TYPE_MOBILE)
                            .put("primary", c.getInt(3) == 1))
                    }
                }
            } catch (_: Throwable) {}
            return out.toString()
        }
        @JavascriptInterface fun call(number: String) {
            main.post {
                val uri = Uri.fromParts("tel", number, null)
                val canCall = act.checkSelfPermission(Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED
                val i = Intent(if (canCall) Intent.ACTION_CALL else Intent.ACTION_DIAL, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                WakeService.setMicBusy(false)
                try { speech?.cancel() } catch (_: Throwable) {}; endActive()
                val viaCar = carIntent?.let { f -> try { f(Intent(Intent.ACTION_CALL, uri)) } catch (_: Throwable) { false } } ?: false
                if (!viaCar) try { act.startActivity(i) } catch (_: Throwable) {}
                if (mini) main.postDelayed({ activity?.finish() }, 300)
            }
        }

        @JavascriptInterface fun micGranted(): Boolean = act.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        @JavascriptInterface fun requestMic() { main.post { askPermissions() } }
    }

}
