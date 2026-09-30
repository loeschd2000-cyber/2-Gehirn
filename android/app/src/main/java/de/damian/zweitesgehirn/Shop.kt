package de.damian.zweitesgehirn

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Amazon: Produkt in den Warenkorb legen (NIE kaufen).
 * Öffnet Amazons offizielle „In den Einkaufswagen“-Seite für die Produktnummer (ASIN).
 * Ist die Bedienungshilfe an, tippt Jarvis dort selbst auf „In den Einkaufswagen“ – niemals auf „Kaufen“.
 */
object Amazon {
    const val PKG = "com.amazon.mShop.android.shopping"
    private val main = Handler(Looper.getMainLooper())
    @Volatile var onResult: ((Boolean, String) -> Unit)? = null
    @Volatile private var token = 0

    fun installed(ctx: Context) = try { ctx.packageManager.getPackageInfo(PKG, 0); true } catch (_: Throwable) { false }
    private fun validAsin(a: String) = Regex("^[A-Z0-9]{10}$").matches(a)

    fun addToCart(ctx: Context, asin: String, qty: Int, result: (Boolean, String) -> Unit) {
        if (!validAsin(asin)) { result(false, "Ungültige Produktnummer"); return }
        val q = qty.coerceIn(1, 20)
        val uri = Uri.parse("https://www.amazon.de/gp/aws/cart/add.html?ASIN.1=$asin&Quantity.1=$q")
        val app = installed(ctx)
        val auto = app && WhatsApp.autoSendEnabled(ctx)
        if (auto) {
            val my = ++token
            WaService.amazonUntil = System.currentTimeMillis() + 25000
            onResult = result
            main.postDelayed({
                if (token == my && WaService.amazonUntil != 0L) { WaService.amazonUntil = 0; onResult = null; result(true, "manuell") }
            }, 25500)
        }
        val opened = (app && tryStart(ctx, Intent(Intent.ACTION_VIEW, uri).setPackage(PKG))) || tryStart(ctx, Intent(Intent.ACTION_VIEW, uri))
        if (!opened) { WaService.amazonUntil = 0; onResult = null; result(false, "Amazon ließ sich nicht öffnen"); return }
        if (!auto) result(true, "manuell")
    }

    fun search(ctx: Context, q: String) {
        val uri = Uri.parse("https://www.amazon.de/s?k=" + Uri.encode(q))
        if (!(installed(ctx) && tryStart(ctx, Intent(Intent.ACTION_VIEW, uri).setPackage(PKG)))) tryStart(ctx, Intent(Intent.ACTION_VIEW, uri))
    }

    fun product(ctx: Context, asin: String) {
        if (!validAsin(asin)) return
        val uri = Uri.parse("https://www.amazon.de/dp/$asin")
        if (!(installed(ctx) && tryStart(ctx, Intent(Intent.ACTION_VIEW, uri).setPackage(PKG)))) tryStart(ctx, Intent(Intent.ACTION_VIEW, uri))
    }

    private fun tryStart(ctx: Context, i: Intent) = try { ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (_: Throwable) { false }

    /** Von der Bedienungshilfe aufgerufen: passenden Knopf suchen und drücken */
    fun findCartButton(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val forbidden = Regex("kauf|bestell|buy|order|zur kasse|checkout|bezahl|pay|abo", RegexOption.IGNORE_CASE)
        for (label in listOf("In den Einkaufswagen", "In den Warenkorb", "Zum Einkaufswagen hinzufügen", "Add to Cart", "Weiter", "Continue")) {
            val hit = root.findAccessibilityNodeInfosByText(label).firstOrNull { n ->
                val t = (n.text ?: n.contentDescription ?: "").toString().trim()
                n.isVisibleToUser && n.isEnabled && t.length <= 40 && t.startsWith(label, true) && !forbidden.containsMatchIn(t)
            }
            if (hit != null) return hit
        }
        return null
    }
}

/** Text in die Zwischenablage (z. B. fertige Kleinanzeige) und Apps/Seiten öffnen */
object Share {
    fun copy(ctx: Context, label: String, text: String) {
        try { ctx.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText(label, text)) } catch (_: Throwable) {}
    }
    /** nur https-Adressen; mit Paket = in dieser App öffnen, falls installiert */
    fun open(ctx: Context, url: String, pkg: String?) {
        if (!url.startsWith("https://")) return
        val i = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (!pkg.isNullOrBlank()) try { ctx.startActivity(Intent(i).setPackage(pkg)); return } catch (_: Throwable) {}
        try { ctx.startActivity(i) } catch (_: Throwable) {}
    }
}

/**
 * Preis-Wächter für Amazon: schaut alle ~6 Stunden (mit Gemini + Google-Suche) nach dem Preis
 * und meldet sich, wenn er unter deine Grenze fällt.
 */
object PriceWatch {
    private fun p(ctx: Context) = ctx.getSharedPreferences("zg_pricewatch", Context.MODE_PRIVATE)
    @Synchronized fun list(ctx: Context): JSONArray = try { JSONArray(p(ctx).getString("list", "[]")) } catch (_: Throwable) { JSONArray() }
    @Synchronized private fun save(ctx: Context, a: JSONArray) { p(ctx).edit().putString("list", a.toString()).apply() }
    fun setModel(ctx: Context, model: String) { if (model.startsWith("models/")) p(ctx).edit().putString("model", model).apply() }

    @Synchronized fun add(ctx: Context, asin: String, name: String, limit: Double, now: Double): Int {
        val a = list(ctx); val id = ((System.nanoTime() / 1000) % 900000).toInt().let { if (it < 0) -it else it } + 1000
        a.put(JSONObject().put("id", id).put("asin", asin).put("name", name.take(80)).put("limit", limit).put("last", now).put("added", System.currentTimeMillis()))
        save(ctx, a); arm(ctx); return id
    }
    @Synchronized fun cancel(ctx: Context, id: Int) {
        val a = list(ctx); val keep = JSONArray()
        for (i in 0 until a.length()) { val o = a.getJSONObject(i); if (id != -1 && o.optInt("id") != id) keep.put(o) }
        save(ctx, keep); arm(ctx)
    }

    private fun pending(ctx: Context) = PendingIntent.getBroadcast(ctx, 8181, Intent(ctx, PriceWatchReceiver::class.java),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    fun arm(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        am.cancel(pending(ctx))
        if (list(ctx).length() == 0) return
        am.setInexactRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + 30 * 60_000L,
            AlarmManager.INTERVAL_HOUR * 6, pending(ctx))
    }

    /** Preis über Gemini + Google-Suche abfragen (Hintergrund-Thread!). null = unbekannt */
    fun lookup(ctx: Context, asin: String, name: String): Double? {
        val key = Secure.vaultGet(ctx, "zg_gemini_key"); if (key.isBlank()) return null
        val model = p(ctx).getString("model", "") ?: ""
        for (m in listOf(model, "models/gemini-flash-latest").filter { it.isNotBlank() }.distinct()) {
            try {
                val body = JSONObject()
                    .put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text",
                        "Wie viel kostet das Produkt „$name“ (ASIN $asin) gerade auf amazon.de (neu, von Amazon oder günstigster Händler)? " +
                        "Antworte nur mit einer Zeile: PREIS: <Betrag in Euro mit Komma> oder PREIS: unbekannt")))))
                    .put("tools", JSONArray().put(JSONObject().put("google_search", JSONObject())))
                val c = URL("https://generativelanguage.googleapis.com/v1beta/$m:generateContent").openConnection() as HttpURLConnection
                c.requestMethod = "POST"; c.connectTimeout = 15000; c.readTimeout = 40000; c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("x-goog-api-key", key)
                c.outputStream.use { it.write(body.toString().toByteArray()) }
                if (c.responseCode !in 200..299) { c.disconnect(); continue }
                val j = JSONObject(c.inputStream.bufferedReader().readText()); c.disconnect()
                val parts = j.optJSONArray("candidates")?.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts") ?: continue
                val txt = (0 until parts.length()).joinToString("") { parts.optJSONObject(it)?.optString("text") ?: "" }
                val mm = Regex("PREIS:\\s*([0-9.]+(?:,[0-9]{1,2})?)").find(txt) ?: return null
                return mm.groupValues[1].replace(".", "").replace(",", ".").toDoubleOrNull()
            } catch (_: Throwable) {}
        }
        return null
    }

    fun check(ctx: Context) {
        val a = list(ctx); if (a.length() == 0) return
        val hits = HashSet<Int>()
        for (i in 0 until a.length()) {
            val o = a.getJSONObject(i)
            val price = lookup(ctx, o.optString("asin"), o.optString("name")) ?: continue
            if (price <= o.optDouble("limit")) {
                hits += o.getInt("id")
                val eur = { v: Double -> "%.2f".format(v).replace(".", ",") + " €" }
                val open = PendingIntent.getActivity(ctx, 8200 + (o.getInt("id") % 99), Intent(Intent.ACTION_VIEW, Uri.parse("https://www.amazon.de/dp/" + o.optString("asin"))).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
                showDeal(ctx, 9500 + (o.getInt("id") % 400), "📉 Preis gefallen: ${o.optString("name").take(40)}",
                    "Jetzt ${eur(price)} – deine Grenze war ${eur(o.optDouble("limit"))}. Tippen öffnet Amazon.", open)
            }
        }
        if (hits.isNotEmpty()) synchronized(this) {
            val cur = list(ctx); val keep = JSONArray()
            for (i in 0 until cur.length()) { val o = cur.getJSONObject(i); if (o.optInt("id") !in hits) keep.put(o) }
            save(ctx, keep); arm(ctx)
        }
    }

    private fun showDeal(ctx: Context, id: Int, title: String, text: String, open: PendingIntent) {
        val nm = ctx.getSystemService(android.app.NotificationManager::class.java)
        if (nm.getNotificationChannel("deals") == null)
            nm.createNotificationChannel(android.app.NotificationChannel("deals", "Preis-Wächter", android.app.NotificationManager.IMPORTANCE_HIGH))
        val n = android.app.Notification.Builder(ctx, "deals").setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(text)
            .setStyle(android.app.Notification.BigTextStyle().bigText(text)).setContentIntent(open).setAutoCancel(true).build()
        try { nm.notify(id, n) } catch (_: Throwable) {}
    }
}

class PriceWatchReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == "android.intent.action.QUICKBOOT_POWERON") { PriceWatch.arm(ctx); return }
        val r = goAsync()
        Thread { try { PriceWatch.check(ctx) } finally { r.finish() } }.start()
    }
}
