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
class NativeBridge(private val act: Activity, val web: WebView, private val mini: Boolean) {

    companion object {
        const val REQ_PERMS = 7
        const val REQ_AUTH = 42
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
        web.addJavascriptInterface(Js(), "ZGAndroid")
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
        tts = TextToSpeech(act) { status ->
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
    }

    fun loadStart() {
        val url = Prefs.appUrl(act)
        if (url.isBlank()) web.loadUrl("file:///android_asset/setup.html") else web.loadUrl(url)
    }

    fun askPermissions() {
        val need = mutableListOf(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) need += Manifest.permission.POST_NOTIFICATIONS
        val missing = need.filter { act.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) act.requestPermissions(missing.toTypedArray(), REQ_PERMS)
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

    fun onResume() { web.evaluateJavascript("window.__zgResume && __zgResume()", null) }
    fun onWakeStopped() { main.post { web.evaluateJavascript("window.__zgWakeState && __zgWakeState(false)", null) } }
    fun isListening(): Boolean = !srEnded

    fun destroy() {
        speech?.destroy(); speech = null
        tts?.stop(); tts?.shutdown(); tts = null
        WakeService.setMicBusy(false); WakeService.setSpeaking(false)
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
        if (!SpeechRecognizer.isRecognitionAvailable(act)) {
            emit("__zgSR", JSONObject().put("type", "error").put("sid", sid).put("error", "service-not-allowed"))
            endSession(); return
        }
        val sr = SpeechRecognizer.createSpeechRecognizer(act)
        speech = sr
        sr.setRecognitionListener(object : RecognitionListener {
            private fun text(b: android.os.Bundle?): String? = b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            override fun onPartialResults(b: android.os.Bundle?) {
                val t = text(b) ?: return
                if (t.isNotBlank()) emit("__zgSR", JSONObject().put("type", "result").put("sid", sid).put("text", t).put("final", false))
            }
            override fun onResults(b: android.os.Bundle?) {
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
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        // kurz warten, damit der Hintergrund-Dienst das Mikrofon sicher freigegeben hat
        main.postDelayed({ if (srActiveSid == sid && !srEnded) sr.startListening(intent) }, 180)
    }

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
                        act.startIntentSenderForResult(res.pendingIntent!!.intentSender, REQ_AUTH, null, 0, 0, 0)
                    } catch (e: Throwable) { googleResult(null, e.message ?: "Anmeldung konnte nicht starten") }
                } else googleResult(res.accessToken, null)
            }
            .addOnFailureListener { e -> googleResult(null, e.message ?: "Google-Anmeldung fehlgeschlagen") }
    }

    /** Muss von der Activity aus onActivityResult aufgerufen werden. */
    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
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
    inner class Js {
        @JavascriptInterface fun version(): String =
            try { act.packageManager.getPackageInfo(act.packageName, 0).versionName ?: "" } catch (_: Throwable) { "" }
        @JavascriptInterface fun isMini(): Boolean = mini

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
        @JavascriptInterface fun consumeWake(): Boolean { val w = pendingWake; pendingWake = false; return w }
        @JavascriptInterface fun wakeScore(): Float = WakeService.lastScore

        // kleiner Kreis
        @JavascriptInterface fun miniClose() { main.post { if (mini) act.finish() } }
        @JavascriptInterface fun openFullApp() {
            main.post {
                act.startActivity(Intent(act, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                if (mini) act.finish()
            }
        }

        // Einrichtung
        @JavascriptInterface fun getAppUrl(): String = Prefs.appUrl(act)
        @JavascriptInterface fun setAppUrl(url: String) {
            Prefs.setAppUrl(act, url.trim())
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
                speech?.cancel()
                if (!installed) { Music.playViaApp(app, query, artist, false); return@post }
                // erst im Hintergrund versuchen, nur wenn das nicht geht kurz über Spotify
                Music.play(app, query, artist) { Music.playViaApp(app, query, artist, wasBig) }
            }
            return installed
        }
        /** Steuert die gerade laufende Musik (Spotify oder jede andere App), ohne sie zu öffnen. */
        @JavascriptInterface fun media(cmd: String) {
            main.post {
                val am = act.getSystemService(AudioManager::class.java)
                when (cmd) {
                    "louder" -> { am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI)
                                  am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, 0) }
                    "quieter" -> { am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
                                   am.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, 0) }
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
        @JavascriptInterface fun alexaAlarm(at: String, label: String): Int = AlexaAlarm.schedule(act, at.toLong(), label)
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
            main.post { act.requestPermissions(arrayOf(Manifest.permission.READ_CONTACTS, Manifest.permission.CALL_PHONE), REQ_PERMS) }
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
                speech?.cancel()
                try { act.startActivity(i) } catch (_: Throwable) {}
                if (mini) main.postDelayed({ act.finish() }, 300)
            }
        }

        @JavascriptInterface fun micGranted(): Boolean = act.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        @JavascriptInterface fun requestMic() { main.post { askPermissions() } }
    }

}
