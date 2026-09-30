package de.damian.zweitesgehirn

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.SystemClock
import android.app.KeyguardManager
import android.hardware.biometrics.BiometricPrompt
import android.view.View
import android.view.WindowInsets
import android.webkit.WebView

/** Die große App: zeigt die ganze Kommandozentrale. */
class MainActivity : Activity() {

    companion object {
        var current: MainActivity? = null
        /** Bis wann die App als „entsperrt“ gilt (für den kleinen Kreis); Long.MAX_VALUE = gerade offen und entsperrt */
        @Volatile var unlockedUntil = 0L
        /** true = private Dinge nicht zeigen (Handy gesperrt oder App-Sperre aktiv und nicht entsperrt) */
        fun privateLocked(ctx: android.content.Context): Boolean {
            val km = ctx.getSystemService(KeyguardManager::class.java)
            if (km?.isKeyguardLocked == true) return true
            return Prefs.appLock(ctx) && (km?.isDeviceSecure == true) && SystemClock.elapsedRealtime() > unlockedUntil
        }
    }

    lateinit var bridge: NativeBridge
    var inForeground = false
        private set
    private var resumed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor(NativeBridge.BG)
        window.navigationBarColor = Color.parseColor(NativeBridge.BG)

        val web = WebView(this)
        web.setBackgroundColor(Color.parseColor(NativeBridge.BG))
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

        bridge = NativeBridge(this, web, mini = false)
        bridge.setup()
        Thread { try { Secure.migrate(applicationContext) } catch (_: Throwable) {} }.start()
        if (lockActive()) showContent(false) else bridge.askPermissions()   // mit Sperre: Rechte erst nach dem Entsperren fragen
        bridge.loadStart()
        current = this
        // Nach dem Neustart aus „Zuletzt verwendet“ keine alten Aufträge (Wecken, Tagebuch …) nochmal ausführen
        val fromHistory = (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        if (savedInstanceState == null && !fromHistory) handleIntent(intent)
    }

    // ---------- App-Sperre ----------
    private var unlocked = false
    private var hiddenAt = 0L
    private var authOpen = false
    private var heldIntent: Intent? = null
    private var afterAuth: (() -> Unit)? = null
    private val REQ_LOCK = 4711

    private fun lockActive(): Boolean = Prefs.appLock(this) && getSystemService(KeyguardManager::class.java).isDeviceSecure

    fun markUnlocked() { unlocked = true; hiddenAt = 0L; if (resumed) unlockedUntil = Long.MAX_VALUE; applyRecents() }

    private fun showContent(show: Boolean) { bridge.web.visibility = if (show) View.VISIBLE else View.INVISIBLE }

    /** Mit App-Sperre kein Vorschaubild in „Zuletzt verwendet“ */
    private fun applyRecents() { if (Build.VERSION.SDK_INT >= 33) try { setRecentsScreenshotEnabled(!Prefs.appLock(this)) } catch (_: Throwable) {} }

    /** Beim Zurückkommen: nach mehr als 1 Minute im Hintergrund wieder entsperren lassen */
    private fun maybeLock() {
        applyRecents()
        if (!lockActive()) { unlocked = true; showContent(true); return }
        if (unlocked && (hiddenAt == 0L || SystemClock.elapsedRealtime() - hiddenAt < 60_000)) { showContent(true); return }
        unlocked = false; showContent(false); unlockedUntil = 0L
        if (!authOpen) authenticate()
    }

    private fun onUnlocked() {
        authOpen = false
        val cb = afterAuth; afterAuth = null
        if (cb != null) { cb(); return }            // nur eine Bestätigung (z. B. Sperre ausschalten)
        unlocked = true; hiddenAt = 0L; showContent(true)
        if (resumed) { inForeground = true; unlockedUntil = Long.MAX_VALUE }
        bridge.askPermissions()
        heldIntent?.let { heldIntent = null; handleIntent(it) }   // was während der Sperre kam, jetzt ausführen
    }

    /** Für „App-Sperre ausschalten“: erst Fingerabdruck/PIN, dann [then] */
    fun confirmThen(then: () -> Unit) {
        if (!getSystemService(KeyguardManager::class.java).isDeviceSecure) { then(); return }
        afterAuth = then
        authenticate()
    }

    private fun authenticate() {
        authOpen = true
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                BiometricPrompt.Builder(this)
                    .setTitle(if (afterAuth != null) "Bestätigen" else "Jarvis entsperren")
                    .setSubtitle("Fingerabdruck, Gesicht oder PIN")
                    .setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK or
                        android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                    .build()
                    .authenticate(CancellationSignal(), mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) { onUnlocked() }
                        override fun onAuthenticationError(code: Int, msg: CharSequence?) {
                            authOpen = false
                            if (afterAuth != null) { afterAuth = null; return }   // Bestätigung abgebrochen: nichts ändern
                            when (code) {
                                BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED -> moveTaskToBack(true)
                                // vom System abgebrochen (z. B. Bildschirm aus, anderes Fenster): beim nächsten Fokus nochmal
                                BiometricPrompt.BIOMETRIC_ERROR_CANCELED -> {}
                                else -> credentialFallback()
                            }
                        }
                    })
                return
            } catch (_: Throwable) {}
        }
        credentialFallback()
    }

    /** Ältere Handys oder Fehler beim Fingerabdruck: normale Handy-PIN abfragen */
    private fun credentialFallback() {
        val km = getSystemService(KeyguardManager::class.java)
        @Suppress("DEPRECATION")
        val i = km.createConfirmDeviceCredentialIntent(if (afterAuth != null) "Bestätigen" else "Jarvis entsperren", "Gib deine Handy-PIN ein")
        if (i == null) { onUnlocked(); return }
        authOpen = true
        try { @Suppress("DEPRECATION") startActivityForResult(i, REQ_LOCK) } catch (_: Throwable) { onUnlocked() }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && !unlocked && !authOpen && lockActive()) authenticate()
    }

    override fun onStart() {
        super.onStart()
        if (::bridge.isInitialized) maybeLock()
    }

    override fun onStop() {
        super.onStop()
        if (unlocked && !authOpen) {
            hiddenAt = SystemClock.elapsedRealtime()
            unlockedUntil = hiddenAt + 60_000   // der kleine Kreis darf noch 1 Minute Privates zeigen
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == NativeBridge.REQ_PERMS && Prefs.wake(this)) WakeService.start(this)
    }

    override fun onResume() {
        super.onResume()
        current = this
        resumed = true
        inForeground = unlocked || !lockActive()   // gesperrt: „Hey Jarvis“ öffnet dann den kleinen Kreis (ohne Privates)
        if (inForeground && lockActive()) unlockedUntil = Long.MAX_VALUE
        if (Prefs.wake(this) && !WakeService.running) WakeService.start(this)
        bridge.onResume()
    }

    override fun onPause() {
        inForeground = false
        resumed = false
        super.onPause()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(i: Intent?) {
        if (i == null) return
        // Während der Sperre nichts ausführen, sondern merken (Bank-/Spotify-Rückkehr, Widget, Wecken)
        if (lockActive() && !unlocked) { heldIntent = Intent(i); i.replaceExtras(Bundle()); i.data = null; return }
        // Widget-Knöpfe: nur feste Befehle (andere Apps dürfen Jarvis keine eigenen Sätze unterschieben)
        when (i.getStringExtra("widget")) {
            "brief" -> bridge.deliverAsk("Guten Morgen")
        }
        i.removeExtra("widget")
        if (i.getBooleanExtra("diary", false)) {
            i.removeExtra("diary")
            bridge.deliverDiary()
        }
        val d = i.data
        if (d != null && d.scheme == "zweitesgehirn" && d.host == "bank-callback") {
            i.data = null
            bridge.js.bankRedirect(d)
            return
        }
        if (d != null && d.scheme == "zweitesgehirn" && d.host == "spotify-callback") {
            i.data = null
            bridge.js.spotifyRedirect(d)
            return
        }
        if (i.getBooleanExtra("wake", false)) {
            i.removeExtra("wake")
            bridge.deliverWake()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_LOCK) {
            authOpen = false
            if (resultCode == RESULT_OK) onUnlocked()
            else if (afterAuth != null) afterAuth = null
            else moveTaskToBack(true)
            return
        }
        bridge.onActivityResult(requestCode, resultCode, data)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (bridge.web.canGoBack()) bridge.web.goBack() else moveTaskToBack(true)
    }

    override fun onDestroy() {
        if (current === this) current = null
        bridge.destroy()
        super.onDestroy()
    }
}
