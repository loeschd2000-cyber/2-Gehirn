package de.damian.zweitesgehirn

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Konto-Umsätze über Enable Banking (offizielle PSD2-Schnittstelle, nur LESEN).
 * Kostenlos im Modus „Restricted Production“ für die eigenen Konten.
 * Deine Bank-Zugangsdaten gibst du nur auf der Seite deiner Bank ein – nie in dieser App.
 * Hier liegen nur: die App-ID, der App-Schlüssel (.pem) und die Sitzung (read-only, läuft von selbst ab).
 */
object BankApi {
    const val API = "https://api.enablebanking.com"
    const val REDIRECT = "https://loeschd2000-cyber.github.io/2-Gehirn/bank.html"
    private fun p(ctx: Context) = ctx.getSharedPreferences("zg_bank", Context.MODE_PRIVATE)

    fun appId(ctx: Context) = p(ctx).getString("app_id", "") ?: ""
    fun hasKey(ctx: Context) = (p(ctx).getString("key", "") ?: "").isNotBlank()
    fun bankName(ctx: Context) = p(ctx).getString("aspsp", "") ?: ""
    fun connected(ctx: Context) = (p(ctx).getString("session", "") ?: "").isNotBlank() &&
        System.currentTimeMillis() < p(ctx).getLong("valid_until", 0)
    fun validUntil(ctx: Context) = p(ctx).getLong("valid_until", 0)

    fun setAppId(ctx: Context, id: String) = p(ctx).edit().putString("app_id", id.trim()).apply()
    fun setBank(ctx: Context, name: String) = p(ctx).edit().putString("aspsp", name).apply()
    fun disconnect(ctx: Context) = p(ctx).edit().remove("session").remove("accounts").remove("cache").remove("valid_until").apply()

    /** Schlüssel-Datei (.pem) speichern. Gibt Fehlertext zurück oder null. */
    fun setKey(ctx: Context, pem: String): String? {
        if (!pem.contains("PRIVATE KEY")) return "Das ist keine Schlüssel-Datei (.pem mit PRIVATE KEY)."
        return try { loadKey(pem); p(ctx).edit().putString("key", pem).apply(); null }
        catch (e: Throwable) { "Schlüssel konnte nicht gelesen werden: ${e.message}" }
    }

    // ---------- Schlüssel + JWT ----------
    private fun der(pem: String) = Base64.decode(pem.replace(Regex("-----[A-Z ]+-----"), "").replace(Regex("\\s"), ""), Base64.DEFAULT)

    /** PKCS#8 („BEGIN PRIVATE KEY“) direkt; PKCS#1 („BEGIN RSA PRIVATE KEY“) wird in PKCS#8 verpackt. */
    private fun loadKey(pem: String): java.security.PrivateKey {
        var bytes = der(pem)
        if (pem.contains("BEGIN RSA PRIVATE KEY")) {
            val algId = byteArrayOf(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86.toByte(), 0x48, 0x86.toByte(), 0xf7.toByte(), 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00)
            val octet = byteArrayOf(0x04) + derLen(bytes.size) + bytes
            val inner = byteArrayOf(0x02, 0x01, 0x00) + algId + octet
            bytes = byteArrayOf(0x30) + derLen(inner.size) + inner
        }
        return KeyFactory.getInstance("RSA").generatePrivate(PKCS8EncodedKeySpec(bytes))
    }
    private fun derLen(n: Int): ByteArray = when {
        n < 0x80 -> byteArrayOf(n.toByte())
        n < 0x100 -> byteArrayOf(0x81.toByte(), n.toByte())
        n < 0x10000 -> byteArrayOf(0x82.toByte(), (n shr 8).toByte(), n.toByte())
        else -> byteArrayOf(0x83.toByte(), (n shr 16).toByte(), (n shr 8).toByte(), n.toByte())
    }
    private fun b64url(b: ByteArray) = Base64.encodeToString(b, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    private fun jwt(ctx: Context): String {
        val now = System.currentTimeMillis() / 1000
        val header = JSONObject().put("typ", "JWT").put("alg", "RS256").put("kid", appId(ctx))
        val body = JSONObject().put("iss", "enablebanking.com").put("aud", "api.enablebanking.com").put("iat", now).put("exp", now + 3600)
        val input = b64url(header.toString().toByteArray()) + "." + b64url(body.toString().toByteArray())
        val sig = Signature.getInstance("SHA256withRSA").apply { initSign(loadKey(p(ctx).getString("key", "")!!)); update(input.toByteArray()) }.sign()
        return input + "." + b64url(sig)
    }

    private fun http(ctx: Context, method: String, path: String, body: JSONObject? = null): Pair<Int, String> = try {
        val c = URL(API + path).openConnection() as HttpURLConnection
        c.requestMethod = method; c.connectTimeout = 15000; c.readTimeout = 30000
        c.setRequestProperty("Authorization", "Bearer " + jwt(ctx))
        c.setRequestProperty("Accept", "application/json")
        if (body != null) {
            c.doOutput = true; c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray()) }
        }
        val code = c.responseCode
        val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: ""
        c.disconnect(); code to text
    } catch (e: Throwable) { -1 to (e.message ?: e.javaClass.simpleName) }

    private fun err(code: Int, text: String): String {
        val m = try { JSONObject(text).let { it.optString("message").ifBlank { it.optString("detail").ifBlank { it.optString("error") } } } } catch (_: Throwable) { text.take(160) }
        return "Fehler $code: $m"
    }

    // ---------- Bank auswählen ----------
    /** Banken in Deutschland, deren Name [query] enthält. Hintergrund-Thread! */
    fun searchBanks(ctx: Context, query: String): JSONObject {
        if (appId(ctx).isBlank() || !hasKey(ctx)) return JSONObject().put("error", "Erst App-ID und Schlüssel-Datei eintragen.")
        val (c, r) = http(ctx, "GET", "/aspsps?country=DE&psu_type=personal")
        if (c != 200) return JSONObject().put("error", err(c, r))
        val all = JSONObject(r).optJSONArray("aspsps") ?: JSONArray()
        // ß/ss, Umlaute, Bindestriche egal; alle Wörter müssen vorkommen („sparkasse hassberge“ findet „Sparkasse Schweinfurt-Haßberge“)
        fun n(x: String) = x.lowercase().replace("ß", "ss").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace(Regex("[^a-z0-9]+"), " ").trim()
        val words = n(query).split(" ").filter { it.isNotBlank() }
        val out = JSONArray()
        for (i in 0 until all.length()) {
            val a = all.getJSONObject(i); val name = a.optString("name"); val nn = n(name + " " + a.optString("bic"))
            if (words.all { nn.contains(it) }) out.put(JSONObject().put("name", name).put("days", a.optLong("maximum_consent_validity", 0) / 86400))
            if (out.length() >= 60) break
        }
        // Nichts gefunden (z. B. „Sparkasse Schweinfurt“)? Dann alles, was EIN Wort enthält – bei Sparkassen gibt es nur den Eintrag „Sparkasse“
        if (out.length() == 0 && words.size > 1) for (i in 0 until all.length()) {
            val a = all.getJSONObject(i); val name = a.optString("name"); val nn = n(name)
            if (words.any { it.length >= 4 && nn.contains(it) }) out.put(JSONObject().put("name", name).put("days", a.optLong("maximum_consent_validity", 0) / 86400))
            if (out.length() >= 60) break
        }
        return JSONObject().put("banks", out)
    }

    /** Freigabe bei der Bank starten (öffnet den Browser). Hintergrund-Thread! Gibt Fehlertext oder null zurück. */
    fun startAuth(ctx: Context, bank: String): String? {
        setBank(ctx, bank)
        val state = b64url(ByteArray(12).also { SecureRandom().nextBytes(it) })
        p(ctx).edit().putString("state", state).apply()
        val days = 180L
        val until = Date(System.currentTimeMillis() + days * 86400000L)
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSSSSXXX", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        val body = JSONObject()
            .put("access", JSONObject().put("valid_until", fmt.format(until)))
            .put("aspsp", JSONObject().put("name", bank).put("country", "DE"))
            .put("state", state).put("redirect_url", REDIRECT).put("psu_type", "personal").put("language", "de")
        var (c, r) = http(ctx, "POST", "/auth", body)
        if (c == 400 || c == 422) {
            // Bank erlaubt keine 180 Tage? Mit 90 Tagen nochmal
            body.getJSONObject("access").put("valid_until", fmt.format(Date(System.currentTimeMillis() + 89L * 86400000L)))
            val second = http(ctx, "POST", "/auth", body); c = second.first; r = second.second
        }
        if (c !in 200..299) return err(c, r)
        val url = JSONObject(r).optString("url")
        return try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); null }
        catch (e: Throwable) { "Browser ließ sich nicht öffnen" }
    }

    /** Rückkehr von der Bank: Code gegen Sitzung tauschen. Hintergrund-Thread! */
    fun handleRedirect(ctx: Context, uri: Uri): Pair<Boolean, String> {
        uri.getQueryParameter("error")?.let { return false to "Bank hat abgelehnt: $it ${uri.getQueryParameter("error_description") ?: ""}" }
        val code = uri.getQueryParameter("code") ?: return false to "Kein Code von der Bank erhalten"
        val state = uri.getQueryParameter("state"); val saved = p(ctx).getString("state", null)
        if (state == null || saved == null || state != saved) return false to "Freigabe passt nicht zusammen, bitte nochmal verbinden"
        p(ctx).edit().remove("state").apply()   // jeder Freigabe-Link gilt nur einmal
        val (c, r) = http(ctx, "POST", "/sessions", JSONObject().put("code", code))
        if (c !in 200..299) return false to err(c, r)
        val j = JSONObject(r)
        val accs = j.optJSONArray("accounts") ?: JSONArray()
        val list = JSONArray()
        for (i in 0 until accs.length()) {
            val a = accs.opt(i)
            if (a is JSONObject) list.put(JSONObject().put("uid", a.optString("uid")).put("iban", a.optJSONObject("account_id")?.optString("iban") ?: "").put("name", a.optString("name")))
            else if (a is String) list.put(JSONObject().put("uid", a))
        }
        val validStr = j.optJSONObject("access")?.optString("valid_until") ?: ""
        val valid = try { SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(validStr.take(19))!!.time } catch (_: Throwable) { System.currentTimeMillis() + 89L * 86400000L }
        p(ctx).edit().putString("session", j.optString("session_id")).putString("accounts", list.toString()).putLong("valid_until", valid).apply()
        return true to "Konto verbunden (${list.length()} Konto/Konten)"
    }

    /**
     * Holt Kontostand + Umsätze der letzten [days] Tage aller verbundenen Konten. Hintergrund-Thread!
     * Ergebnis-JSON: { ok, balance, currency, fetched, transactions:[{date, amount, name, text}] } – Beträge mit Vorzeichen.
     */
    fun fetch(ctx: Context, days: Int = 180): JSONObject {
        if (!connected(ctx)) return JSONObject().put("ok", false).put("error", "Konto nicht verbunden oder Freigabe abgelaufen")
        val accs = JSONArray(p(ctx).getString("accounts", "[]"))
        val day = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val from = day.format(Date(System.currentTimeMillis() - days * 86400000L))
        var balance = 0.0; var cur = "EUR"
        val txs = JSONArray()
        for (i in 0 until accs.length()) {
            val uid = accs.getJSONObject(i).optString("uid")
            val (bc, br) = http(ctx, "GET", "/accounts/$uid/balances")
            if (bc == 200) {
                val bs = JSONObject(br).optJSONArray("balances") ?: JSONArray()
                var best: JSONObject? = null
                for (k in 0 until bs.length()) {
                    val b = bs.getJSONObject(k); val t = b.optString("balance_type")
                    if (best == null || t == "CLBD" || (t == "ITAV" && best.optString("balance_type") != "CLBD") || t == "CLAV" && best.optString("balance_type") !in listOf("CLBD", "ITAV")) best = b
                }
                best?.optJSONObject("balance_amount")?.let { balance += it.optString("amount", "0").toDoubleOrNull() ?: 0.0; cur = it.optString("currency", "EUR") }
            } else if (bc == 401 || bc == 403) {
                return JSONObject().put("ok", false).put("error", "Freigabe abgelaufen – bitte Konto neu verbinden (" + err(bc, br) + ")")
            }
            var cont: String? = null; var pages = 0
            do {
                val q = "/accounts/$uid/transactions?date_from=$from" + (cont?.let { "&continuation_key=" + URLEncoder.encode(it, "UTF-8") } ?: "")
                val (tc, tr) = http(ctx, "GET", q)
                if (tc != 200) {
                    if (pages == 0 && days > 89) return fetch(ctx, 89)   // manche Sparkassen geben ohne neue TAN nur 90 Tage
                    if (pages > 0) break                                  // Folgeseite kaputt: mit dem bisher Geladenen weitermachen
                    return JSONObject().put("ok", false).put("error", err(tc, tr))
                }
                val tj = JSONObject(tr)
                val arr = tj.optJSONArray("transactions") ?: JSONArray()
                for (k in 0 until arr.length()) {
                    val t = arr.getJSONObject(k)
                    val amt = t.optJSONObject("transaction_amount")?.optString("amount", "0")?.toDoubleOrNull() ?: 0.0
                    val credit = t.optString("credit_debit_indicator") == "CRDT"
                    val signed = if (credit) Math.abs(amt) else -Math.abs(amt)
                    val other = if (credit) t.optJSONObject("debtor")?.optString("name") else t.optJSONObject("creditor")?.optString("name")
                    val info = t.optJSONArray("remittance_information")?.let { a -> (0 until a.length()).joinToString(" ") { a.optString(it) } } ?: ""
                    txs.put(JSONObject()
                        .put("date", t.optString("booking_date").ifBlank { t.optString("value_date") })
                        .put("amount", signed)
                        .put("name", (other ?: "").trim())
                        .put("text", info.trim().take(140))
                        .put("code", t.optJSONObject("bank_transaction_code")?.optString("description") ?: ""))
                }
                // Achtung: JSON-null liefert bei optString den Text "null" – das ist KEIN Schlüssel
                cont = if (tj.isNull("continuation_key")) null else tj.optString("continuation_key").takeIf { it.isNotBlank() && it != "null" }
                pages++
            } while (cont != null && pages < 30)
        }
        val out = JSONObject().put("ok", true).put("balance", balance).put("currency", cur)
            .put("fetched", System.currentTimeMillis()).put("bank", bankName(ctx)).put("validUntil", validUntil(ctx)).put("transactions", txs)
        p(ctx).edit().putString("cache", out.toString()).apply()
        return out
    }

    fun cached(ctx: Context): String = p(ctx).getString("cache", "") ?: ""
}
