package de.damian.zweitesgehirn

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebView

/**
 * Der kleine Kreis wie bei Siri: ein schmales, durchsichtiges Fenster unten am Bildschirm.
 * Alles darüber bleibt sichtbar und bedienbar. Funktioniert auch auf dem Sperrbildschirm.
 */
class MiniActivity : Activity() {

    companion object {
        var current: MiniActivity? = null
    }

    lateinit var bridge: NativeBridge

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }

        // Fenster nur unten, Rest des Bildschirms bleibt für die App darunter bedienbar
        window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        window.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL)
        val h = (resources.displayMetrics.density * 330).toInt()
        window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, h)
        window.setGravity(Gravity.BOTTOM)

        if (Prefs.appUrl(this).isBlank()) {   // noch nicht eingerichtet -> große App öffnen
            startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish(); return
        }

        val web = WebView(this)
        web.setBackgroundColor(Color.TRANSPARENT)
        setContentView(web)
        // Nicht unter der Navigationsleiste / Tastatur verschwinden (Android 15 zeichnet bis zum Rand)
        web.setOnApplyWindowInsetsListener { v, insets ->
            val bottom = if (Build.VERSION.SDK_INT >= 30)
                insets.getInsets(android.view.WindowInsets.Type.navigationBars() or android.view.WindowInsets.Type.ime()).bottom
            else @Suppress("DEPRECATION") insets.systemWindowInsetBottom
            v.setPadding(0, 0, 0, bottom); insets
        }
        bridge = NativeBridge(this, web, mini = true)
        bridge.setup()
        bridge.loadStart()
        current = this
        if (intent?.getBooleanExtra("wake", false) == true) bridge.deliverWake()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra("wake", false) && ::bridge.isInitialized) bridge.deliverWake()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (::bridge.isInitialized) bridge.onActivityResult(requestCode, resultCode, data)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { finish() }

    override fun onDestroy() {
        if (current === this) current = null
        if (::bridge.isInitialized) bridge.destroy()
        super.onDestroy()
    }
}
