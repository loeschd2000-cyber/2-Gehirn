package de.damian.zweitesgehirn

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
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
        bridge.askPermissions()
        bridge.loadStart()
        current = this
        handleIntent(intent)
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
        if (i?.getBooleanExtra("wake", false) == true) {
            i.removeExtra("wake")
            bridge.deliverWake()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
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
