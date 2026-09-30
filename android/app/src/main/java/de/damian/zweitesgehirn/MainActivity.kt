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
    }

    lateinit var bridge: NativeBridge
    var inForeground = false
        private set

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
        if (Prefs.appLock(this)) showContent(false)   // erst nach dem Entsperren zeigen
        bridge.askPermissions()
        bridge.loadStart()
        current = this
        handleIntent(intent)
    }

    // ---------- App-Sperre ----------
    private var unlocked = false
    private var hiddenAt = 0L
    private var authOpen = false
    private val REQ_LOCK = 4711

    fun markUnlocked() { unlocked = true; hiddenAt = 0L }

    private fun showContent(show: Boolean) { bridge.web.visibility = if (show) View.VISIBLE else View.INVISIBLE }

    /** Beim Zurückkommen: nach mehr als 1 Minute im Hintergrund wieder entsperren lassen */
    private fun maybeLock() {
        if (!Prefs.appLock(this)) { unlocked = true; showContent(true); return }
        val km = getSystemService(KeyguardManager::class.java)
        if (!km.isDeviceSecure) { unlocked = true; showContent(true); return }   // keine Handy-Sperre eingerichtet
        if (unlocked && (hiddenAt == 0L || SystemClock.elapsedRealtime() - hiddenAt < 60_000)) { showContent(true); return }
        unlocked = false; showContent(false)
        if (!authOpen) authenticate()
    }

    private fun onUnlocked() { authOpen = false; unlocked = true; hiddenAt = 0L; showContent(true) }

    private fun authenticate() {
        authOpen = true
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                BiometricPrompt.Builder(this)
                    .setTitle("Jarvis entsperren")
                    .setSubtitle("Fingerabdruck, Gesicht oder PIN")
                    .setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK or
                        android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                    .build()
                    .authenticate(CancellationSignal(), mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) { onUnlocked() }
                        override fun onAuthenticationError(code: Int, msg: CharSequence?) {
                            authOpen = false
                            if (code == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED || code == BiometricPrompt.BIOMETRIC_ERROR_CANCELED) moveTaskToBack(true)
                            else credentialFallback()
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
        val i = km.createConfirmDeviceCredentialIntent("Jarvis entsperren", "Gib deine Handy-PIN ein")
        if (i == null) { onUnlocked(); return }
        authOpen = true
        try { @Suppress("DEPRECATION") startActivityForResult(i, REQ_LOCK) } catch (_: Throwable) { onUnlocked() }
    }

    override fun onStart() {
        super.onStart()
        if (::bridge.isInitialized) maybeLock()
    }

    override fun onStop() {
        super.onStop()
        if (unlocked && !authOpen) hiddenAt = SystemClock.elapsedRealtime()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == NativeBridge.REQ_PERMS && Prefs.wake(this)) WakeService.start(this)
    }

    override fun onResume() {
        super.onResume()
        current = this
        inForeground = true
        if (Prefs.wake(this) && !WakeService.running) WakeService.start(this)
        bridge.onResume()
    }

    override fun onPause() {
        inForeground = false
        super.onPause()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(i: Intent?) {
        i?.getStringExtra("ask")?.let { q -> i.removeExtra("ask"); if (q.isNotBlank() && q.length < 300) bridge.deliverAsk(q) }
        if (i?.getBooleanExtra("diary", false) == true) {
            i.removeExtra("diary")
            bridge.deliverDiary()
        }
        val d = i?.data
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
        if (i?.getBooleanExtra("wake", false) == true) {
            i.removeExtra("wake")
            bridge.deliverWake()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_LOCK) { authOpen = false; if (resultCode == RESULT_OK) onUnlocked() else moveTaskToBack(true); return }
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
