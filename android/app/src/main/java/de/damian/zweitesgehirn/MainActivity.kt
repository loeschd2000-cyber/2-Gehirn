package de.damian.zweitesgehirn

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.view.WindowInsets
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
 * Zeigt deine Zweites-Gehirn-Web-App an und gibt ihr, was eine Webseite allein nicht darf:
 * Mikrofon + Spracherkennung, Vorlesen, Google-Anmeldung und "Hey Jarvis" im Hintergrund.
 * Die Web-App spricht über das JavaScript-Objekt "ZGAndroid" mit dieser Klasse.
 */
class MainActivity : Activity() {

    companion object {
        var current: MainActivity? = null
        private const val REQ_PERMS = 7
        private const val REQ_AUTH = 42
        private const val BG = "#040b16"
    }

    private lateinit var web: WebView
    private val main = Handler(Looper.getMainLooper())
    private var tts: TextToSpeech? = null
    private var speech: SpeechRecognizer? = null
    private var srSid = 0
    private var srActiveSid = 0
    private var srEnded = true
    private var pendingWake = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        window.statusBarColor = Color.parseColor(BG)
        window.navigationBarColor = Color.parseColor(BG)

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor(BG))
        setContentView(web)
        // Platz für Statusleiste, Navigationsleiste und Tastatur lassen
        web.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }

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
        web.addJavascriptInterface(Bridge(), "ZGAndroid")
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                val app = Uri.parse(Prefs.appUrl(this@MainActivity))
                if (u.scheme == "file" || (u.host != null && u.host == app.host)) return false
                // Links zu anderen Seiten (z. B. Google Kalender) im normalen Browser öffnen
                try { startActivity(Intent(Intent.ACTION_VIEW, u)) } catch (_: Throwable) {}
                return true
            }
        }

        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.setLanguage(Locale.GERMANY)
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(id: String) { emit("__zgTTS", JSONObject().put("type", "start").put("id", id)) }
                    override fun onDone(id: String) { ttsFinished(id, "end") }
                    @Deprecated("alt") override fun onError(id: String) { ttsFinished(id, "error") }
                    override fun onError(id: String, errorCode: Int) { ttsFinished(id, "error") }
                    override fun onStop(id: String, interrupted: Boolean) { ttsFinished(id, "end") }
                })
                main.post { web.evaluateJavascript("window.__zgTTS && __zgTTS.voices()", null) }
            }
        }

        askPermissions()
        loadStart()
        handleIntent(intent)
    }

    private fun loadStart() {
        val url = Prefs.appUrl(this)
        if (url.isBlank()) web.loadUrl("file:///android_asset/setup.html") else web.loadUrl(url)
    }

    private fun askPermissions() {
        val need = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) need += Manifest.permission.POST_NOTIFICATIONS
        val missing = need.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), REQ_PERMS)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_PERMS && Prefs.wake(this)) WakeService.start(this)
    }

    override fun onResume() {
        super.onResume()
        current = this
        if (Prefs.wake(this) && !WakeService.running) WakeService.start(this)
        web.evaluateJavascript("window.__zgResume && __zgResume()", null)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(i: Intent?) {
        if (i?.getBooleanExtra("wake", false) == true) {
            i.removeExtra("wake")
            deliverWake()
        }
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

    fun onWakeStoppedFromNotification() {
        main.post { web.evaluateJavascript("window.__zgWakeState && __zgWakeState(false)", null) }
    }

    fun isListeningNative(): Boolean = !srEnded

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
    }

    override fun onDestroy() {
        if (current === this) current = null
        speech?.destroy(); speech = null
        tts?.shutdown(); tts = null
        WakeService.setMicBusy(false); WakeService.setSpeaking(false)
        super.onDestroy()
    }

    // ---------- Hilfen ----------
    private fun emit(target: String, obj: JSONObject) {
        val code = "window.$target && $target.emit($obj)"
        main.post { web.evaluateJavascript(code, null) }
    }

    private fun ttsFinished(id: String, type: String) {
        emit("__zgTTS", JSONObject().put("type", type).put("id", id))
        main.postDelayed({ WakeService.setSpeaking(tts?.isSpeaking == true) }, 400)
    }

    // ---------- Spracherkennung ----------
    private fun startRecognition(sid: Int, lang: String, interim: Boolean) {
        WakeService.setMicBusy(true)
        speech?.destroy()
        srActiveSid = sid
        srEnded = false
        fun endSession() {
            if (srActiveSid != sid || srEnded) return
            srEnded = true
            emit("__zgSR", JSONObject().put("type", "end").put("sid", sid))
            main.postDelayed({ if (srEnded) WakeService.setMicBusy(false) }, 400)
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            emit("__zgSR", JSONObject().put("type", "error").put("sid", sid).put("error", "service-not-allowed"))
            endSession(); return
        }
        val sr = SpeechRecognizer.createSpeechRecognizer(this)
        speech = sr
        sr.setRecognitionListener(object : RecognitionListener {
            private fun text(b: Bundle?): String? = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            override fun onPartialResults(b: Bundle?) {
                val t = text(b) ?: return
                if (t.isNotBlank()) emit("__zgSR", JSONObject().put("type", "result").put("sid", sid).put("text", t).put("final", false))
            }
            override fun onResults(b: Bundle?) {
                val t = text(b)
                if (!t.isNullOrBlank()) emit("__zgSR", JSONObject().put("type", "result").put("sid", sid).put("text", t).put("final", true))
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
            override fun onReadyForSpeech(p: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(v: Float) {}
            override fun onBufferReceived(b: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(t: Int, p: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, interim)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        // kurz warten, damit der Hintergrund-Dienst das Mikrofon sicher freigegeben hat
        main.postDelayed({ if (srActiveSid == sid && !srEnded) sr.startListening(intent) }, 180)
    }

    // ---------- Google-Anmeldung (für Kalender, Gmail, Kontakte, Drive) ----------
    private fun requestGoogle(scopes: String) {
        val req = AuthorizationRequest.builder()
            .setRequestedScopes(scopes.split(" ").filter { it.isNotBlank() }.map { Scope(it) })
            .build()
        Identity.getAuthorizationClient(this).authorize(req)
            .addOnSuccessListener { res ->
                if (res.hasResolution()) {
                    try {
                        @Suppress("DEPRECATION")
                        startIntentSenderForResult(res.pendingIntent!!.intentSender, REQ_AUTH, null, 0, 0, 0)
                    } catch (e: Throwable) { googleResult(null, e.message ?: "Anmeldung konnte nicht starten") }
                } else googleResult(res.accessToken, null)
            }
            .addOnFailureListener { e -> googleResult(null, e.message ?: "Google-Anmeldung fehlgeschlagen") }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_AUTH) return
        try {
            val res = Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data)
            googleResult(res.accessToken, null)
        } catch (e: Throwable) { googleResult(null, if (resultCode == RESULT_CANCELED) "Anmeldung abgebrochen" else (e.message ?: "Anmeldung fehlgeschlagen")) }
    }

    private fun googleResult(token: String?, error: String?) {
        val o = JSONObject()
        if (!token.isNullOrBlank()) o.put("token", token) else o.put("error", error ?: "Kein Zugriff erhalten")
        emit("__zgGoogle", o)
    }

    /** Alles, was die Web-App aufrufen darf */
    inner class Bridge {
        @JavascriptInterface fun version(): String =
            try { packageManager.getPackageInfo(packageName, 0).versionName ?: "" } catch (_: Throwable) { "" }

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
                speech?.cancel()
                emit("__zgSR", JSONObject().put("type", "error").put("sid", sid).put("error", "aborted"))
                srEnded = true
                emit("__zgSR", JSONObject().put("type", "end").put("sid", sid))
                main.postDelayed({ if (srEnded) WakeService.setMicBusy(false) }, 400)
            }
        }

        // Vorlesen
        @JavascriptInterface fun ttsSpeak(id: String, text: String, voice: String, rate: Float) {
            main.post {
                val t = tts ?: return@post
                if (voice.isNotBlank()) t.voices?.firstOrNull { it.name == voice }?.let { t.setVoice(it) }
                t.setSpeechRate(rate)
                WakeService.setSpeaking(true)
                t.speak(text, TextToSpeech.QUEUE_ADD, null, id)
            }
        }
        @JavascriptInterface fun ttsCancel() { main.post { tts?.stop(); main.postDelayed({ WakeService.setSpeaking(false) }, 300) } }
        @JavascriptInterface fun ttsVoices(): String {
            val arr = JSONArray()
            try {
                tts?.voices?.filter { it.locale.language == "de" }?.sortedBy { it.isNetworkConnectionRequired }?.forEach {
                    arr.put(JSONObject().put("name", it.name).put("lang", it.locale.toLanguageTag()).put("online", it.isNetworkConnectionRequired))
                }
            } catch (_: Throwable) {}
            return arr.toString()
        }

        // Google
        @JavascriptInterface fun googleToken(scopes: String) { main.post { requestGoogle(scopes) } }

        // "Hey Jarvis"
        @JavascriptInterface fun wakeSet(on: Boolean) {
            main.post {
                Prefs.setWake(this@MainActivity, on)
                if (on) { askPermissions(); WakeService.start(this@MainActivity) } else WakeService.stop(this@MainActivity)
            }
        }
        @JavascriptInterface fun wakeOn(): Boolean = Prefs.wake(this@MainActivity)
        @JavascriptInterface fun consumeWake(): Boolean { val w = pendingWake; pendingWake = false; return w }
        @JavascriptInterface fun wakeScore(): Float = WakeService.lastScore

        // Einrichtung
        @JavascriptInterface fun getAppUrl(): String = Prefs.appUrl(this@MainActivity)
        @JavascriptInterface fun setAppUrl(url: String) {
            Prefs.setAppUrl(this@MainActivity, url.trim())
            main.post { loadStart() }
        }
        @JavascriptInterface fun openSetup() { main.post { web.loadUrl("file:///android_asset/setup.html") } }
        @JavascriptInterface fun openApp() { main.post { loadStart() } }
        @JavascriptInterface fun overlayGranted(): Boolean = Settings.canDrawOverlays(this@MainActivity)
        @JavascriptInterface fun openOverlaySettings() {
            main.post { try { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) } catch (_: Throwable) {} }
        }
        @JavascriptInterface fun batteryOk(): Boolean =
            getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)
        @SuppressLint("BatteryLife")
        @JavascriptInterface fun openBatterySettings() {
            main.post {
                try { startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName"))) }
                catch (_: Throwable) { try { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) } catch (_: Throwable) {} }
            }
        }
        @JavascriptInterface fun micGranted(): Boolean = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        @JavascriptInterface fun requestMic() { main.post { askPermissions() } }
    }
}
