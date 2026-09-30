package de.damian.zweitesgehirn

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * WhatsApp-Nachricht per Sprache. Jarvis öffnet den Chat mit fertigem Text.
 * Ist die Bedienungshilfe „Zweites Gehirn – WhatsApp senden“ an, tippt sie selbst auf „Senden“
 * und geht danach zurück. Es wird nur das offizielle WhatsApp geöffnet – kein inoffizieller Zugang.
 */
object WhatsApp {
    private val main = Handler(Looper.getMainLooper())
    val PACKAGES = listOf("com.whatsapp", "com.whatsapp.w4b")

    fun installedPackage(ctx: Context): String? = PACKAGES.firstOrNull {
        try { ctx.packageManager.getPackageInfo(it, 0); true } catch (_: Throwable) { false }
    }

    fun autoSendEnabled(ctx: Context): Boolean {
        val s = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        return s.split(":").any { it.startsWith(ctx.packageName + "/") }
    }

    fun openAutoSendSettings(ctx: Context) {
        try { ctx.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Throwable) {}
    }

    /** Telefonnummer ins internationale Format ohne + (z. B. 4917612345678) */
    fun intl(ctx: Context, number: String): String {
        val iso = (ctx.getSystemService(TelephonyManager::class.java)?.let { it.simCountryIso.ifBlank { it.networkCountryIso } } ?: "").ifBlank { "de" }.uppercase()
        val e164 = try { PhoneNumberUtils.formatNumberToE164(number, iso) } catch (_: Throwable) { null }
        if (!e164.isNullOrBlank()) return e164.removePrefix("+")
        var d = number.filter { it.isDigit() || it == '+' }
        if (d.startsWith("+")) return d.drop(1)
        if (d.startsWith("00")) return d.drop(2)
        if (d.startsWith("0")) d = "49" + d.drop(1)
        return d
    }

    /** Ergebnis-Rückmeldung (geklappt, Text) */
    @Volatile var onResult: ((Boolean, String) -> Unit)? = null
    @Volatile private var sendToken = 0

    fun send(ctx: Context, number: String, text: String, backToApp: Boolean, result: (Boolean, String) -> Unit): Boolean {
        val pkg = installedPackage(ctx) ?: run { result(false, "WhatsApp ist nicht installiert"); return false }
        val phone = intl(ctx, number)
        val uri = Uri.parse("https://api.whatsapp.com/send?phone=$phone&text=" + Uri.encode(text))
        val auto = autoSendEnabled(ctx)
        if (auto) {
            WaService.backToApp = backToApp
            val token = ++sendToken   // jede Nachricht hat ihre eigene Nummer, damit alte Zeitlimits neue nicht abbrechen
            WaService.pendingUntil = System.currentTimeMillis() + 15000
            onResult = result
            main.postDelayed({
                if (sendToken == token && WaService.pendingUntil != 0L) { WaService.pendingUntil = 0; onResult = null; result(false, "Senden-Knopf nicht gefunden – bitte selbst auf Senden tippen") }
            }, 15500)
        }
        return try {
            ctx.startActivity(Intent(Intent.ACTION_VIEW, uri).setPackage(pkg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            if (!auto) result(true, "manuell")
            true
        } catch (e: Throwable) { WaService.pendingUntil = 0; onResult = null; result(false, "WhatsApp ließ sich nicht öffnen"); false }
    }
}

/** Bedienungshilfe: drückt in WhatsApp auf „Senden“, aber nur direkt nachdem Jarvis eine Nachricht vorbereitet hat. */
class WaService : AccessibilityService() {
    companion object {
        @Volatile var pendingUntil = 0L
        @Volatile var backToApp = false
    }
    private val main = Handler(Looper.getMainLooper())

    override fun onAccessibilityEvent(e: AccessibilityEvent?) {
        if (pendingUntil == 0L || System.currentTimeMillis() > pendingUntil) return
        val pkg = e?.packageName?.toString() ?: return
        if (!pkg.startsWith("com.whatsapp")) return
        val root = rootInActiveWindow ?: return
        val btn = findSend(root, pkg) ?: return
        pendingUntil = 0
        var n: AccessibilityNodeInfo? = btn
        while (n != null && !n.isClickable) n = n.parent
        val ok = (n ?: btn).performAction(AccessibilityNodeInfo.ACTION_CLICK)
        val cb = WhatsApp.onResult; WhatsApp.onResult = null
        main.postDelayed({
            if (backToApp) {
                try { startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) } catch (_: Throwable) {}
            } else performGlobalAction(GLOBAL_ACTION_HOME)
            cb?.invoke(ok, if (ok) "gesendet" else "Senden hat nicht geklappt")
        }, 700)
    }

    private fun findSend(root: AccessibilityNodeInfo, pkg: String): AccessibilityNodeInfo? {
        root.findAccessibilityNodeInfosByViewId("$pkg:id/send").firstOrNull { it.isVisibleToUser && it.isEnabled }?.let { return it }
        for (label in listOf("Senden", "Send")) {
            root.findAccessibilityNodeInfosByText(label).firstOrNull {
                it.isVisibleToUser && it.isEnabled && (it.contentDescription?.toString().equals(label, true))
            }?.let { return it }
        }
        return null
    }

    override fun onInterrupt() {}
}
