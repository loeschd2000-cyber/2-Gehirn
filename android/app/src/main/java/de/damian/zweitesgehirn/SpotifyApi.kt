package de.damian.zweitesgehirn

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.text.Normalizer

/**
 * Spotify über die offizielle Schnittstelle (Web API, braucht Premium):
 * Lied/Künstler suchen und direkt auf deinem Handy abspielen – ohne dass Spotify aufgeht.
 * Anmeldung einmalig im Browser (PKCE, kein Geheimnis nötig). Die Rückleitung läuft über
 * die Seite spotify.html auf GitHub Pages, die dann die App öffnet.
 */
object SpotifyApi {
    const val REDIRECT = "https://loeschd2000-cyber.github.io/2-Gehirn/spotify.html"
    private const val SCOPES = "user-modify-playback-state user-read-playback-state"
    private fun p(ctx: Context) = ctx.getSharedPreferences("zg_spotify", Context.MODE_PRIVATE)

    fun clientId(ctx: Context) = p(ctx).getString("client_id", "") ?: ""
    fun connected(ctx: Context) = (p(ctx).getString("refresh", "") ?: "").isNotBlank()
    fun setClientId(ctx: Context, id: String) = p(ctx).edit().putString("client_id", id.trim()).apply()
    fun disconnect(ctx: Context) = p(ctx).edit().remove("refresh").remove("access").remove("exp").apply()

    private fun b64url(b: ByteArray) = Base64.encodeToString(b, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    /** Öffnet die Spotify-Anmeldung im Browser. */
    fun startLogin(ctx: Context): Boolean {
        val id = clientId(ctx); if (id.isBlank()) return false
        val verifier = b64url(ByteArray(48).also { SecureRandom().nextBytes(it) })
        val challenge = b64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
        val state = b64url(ByteArray(12).also { SecureRandom().nextBytes(it) })
        p(ctx).edit().putString("verifier", verifier).putString("state", state).apply()
        val url = Uri.parse("https://accounts.spotify.com/authorize").buildUpon()
            .appendQueryParameter("client_id", id)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("redirect_uri", REDIRECT)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("state", state)
            .appendQueryParameter("scope", SCOPES)
            .build()
        return try { ctx.startActivity(Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (_: Throwable) { false }
    }

    /** Rückkehr aus dem Browser (zweitesgehirn://spotify-callback?code=…). Läuft im Hintergrund-Thread. */
    fun handleRedirect(ctx: Context, uri: Uri): Pair<Boolean, String> {
        uri.getQueryParameter("error")?.let { return false to "Spotify hat abgelehnt: $it" }
        val code = uri.getQueryParameter("code") ?: return false to "Kein Code von Spotify erhalten"
        val state = uri.getQueryParameter("state")
        if (state != p(ctx).getString("state", null)) return false to "Anmeldung passt nicht zusammen, bitte nochmal verbinden"
        val body = form("grant_type" to "authorization_code", "code" to code, "redirect_uri" to REDIRECT,
            "client_id" to clientId(ctx), "code_verifier" to (p(ctx).getString("verifier", "") ?: ""))
        val (c, r) = http("POST", "https://accounts.spotify.com/api/token", null, body, form = true)
        if (c != 200) return false to "Anmeldung fehlgeschlagen ($c): ${errText(r)}"
        saveTokens(ctx, JSONObject(r))
        return true to "Spotify ist verbunden"
    }

    private fun saveTokens(ctx: Context, j: JSONObject) {
        val e = p(ctx).edit()
            .putString("access", j.optString("access_token"))
            .putLong("exp", System.currentTimeMillis() + j.optLong("expires_in", 3600) * 1000 - 60000)
        if (j.optString("refresh_token").isNotBlank()) e.putString("refresh", j.optString("refresh_token"))
        e.apply()
    }

    private fun token(ctx: Context): String? {
        val acc = p(ctx).getString("access", "") ?: ""
        if (acc.isNotBlank() && System.currentTimeMillis() < p(ctx).getLong("exp", 0)) return acc
        val ref = p(ctx).getString("refresh", "") ?: ""; if (ref.isBlank()) return null
        val (c, r) = http("POST", "https://accounts.spotify.com/api/token", null,
            form("grant_type" to "refresh_token", "refresh_token" to ref, "client_id" to clientId(ctx)), form = true)
        if (c != 200) return null
        saveTokens(ctx, JSONObject(r))
        return p(ctx).getString("access", null)
    }

    private fun norm(s: String) = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD)
        .replace(Regex("\\p{M}"), "").replace(Regex("[^a-z0-9]+"), " ").trim()

    /**
     * Sucht und spielt ab. Muss in einem Hintergrund-Thread laufen.
     * [log] schreibt ins Protokoll. Rückgabe: (geklappt, Titel oder Fehlertext)
     */
    fun play(ctx: Context, query: String, artistHint: String, log: (String) -> Unit): Pair<Boolean, String> {
        val tok = token(ctx) ?: return false to "Spotify ist nicht verbunden"
        val q = URLEncoder.encode(query, "UTF-8")
        val (sc, sr) = http("GET", "https://api.spotify.com/v1/search?q=$q&type=artist,track,playlist&limit=5&market=from_token", tok)
        if (sc != 200) { log("Suche fehlgeschlagen ($sc): ${errText(sr)}"); return false to "Spotify-Suche ging nicht ($sc)" }
        val js = JSONObject(sr)
        val nq = norm(query)
        val artists = js.optJSONObject("artists")?.optJSONArray("items")
        val tracks = js.optJSONObject("tracks")?.optJSONArray("items")
        var body: JSONObject? = null; var label = ""
        // Künstler, wenn der Name passt (oder „Musik von …“ gesagt wurde)
        if (artists != null) for (i in 0 until artists.length()) {
            val a = artists.optJSONObject(i) ?: continue
            if (norm(a.optString("name")) == nq || (artistHint.isNotBlank() && i == 0)) {
                body = JSONObject().put("context_uri", a.optString("uri")); label = a.optString("name") + " (Künstler)"; break
            }
        }
        if (body == null && tracks != null && tracks.length() > 0) {
            val t = tracks.getJSONObject(0)
            val by = t.optJSONArray("artists")?.optJSONObject(0)?.optString("name") ?: ""
            body = JSONObject().put("uris", org.json.JSONArray().put(t.optString("uri"))); label = t.optString("name") + " – " + by
        }
        if (body == null && artists != null && artists.length() > 0) {
            val a = artists.getJSONObject(0)
            body = JSONObject().put("context_uri", a.optString("uri")); label = a.optString("name") + " (Künstler)"
        }
        if (body == null) { log("Nichts gefunden"); return false to "Auf Spotify nichts zu „$query“ gefunden" }
        log("Gefunden: $label")

        // Gerät: dieses Handy. Läuft Spotify nicht, erst im Hintergrund wecken.
        var dev = pickDevice(tok, log)
        if (dev == null) {
            log("Handy ist noch kein Spotify-Gerät → wecke Spotify")
            Music.wakeSpotifyPublic(ctx)
            for (i in 0 until 8) { Thread.sleep(700); dev = pickDevice(tok, null); if (dev != null) break }
        }
        if (dev == null) { log("Kein Spotify-Gerät gefunden"); return false to "Spotify läuft auf keinem Gerät" }
        log("Gerät: ${dev.second}")
        val (pc, pr) = http("PUT", "https://api.spotify.com/v1/me/player/play?device_id=" + URLEncoder.encode(dev.first, "UTF-8"), tok, body.toString())
        if (pc in 200..299) { log("✓ Spielt: $label"); return true to label }
        log("Abspielen fehlgeschlagen ($pc): ${errText(pr)}")
        return false to "Spotify wollte nicht abspielen ($pc)"
    }

    /** (id, name) des Handys, sonst des aktiven Geräts */
    private fun pickDevice(tok: String, log: ((String) -> Unit)?): Pair<String, String>? {
        val (c, r) = http("GET", "https://api.spotify.com/v1/me/player/devices", tok)
        if (c != 200) { log?.invoke("Geräteliste ging nicht ($c)"); return null }
        val arr = JSONObject(r).optJSONArray("devices") ?: return null
        var best: JSONObject? = null
        for (i in 0 until arr.length()) {
            val d = arr.getJSONObject(i)
            if (d.optString("type").equals("Smartphone", true)) { best = d; break }
        }
        if (best == null) for (i in 0 until arr.length()) if (arr.getJSONObject(i).optBoolean("is_active")) best = arr.getJSONObject(i)
        log?.invoke("Spotify-Geräte: " + (0 until arr.length()).joinToString { arr.getJSONObject(it).optString("name") + " (" + arr.getJSONObject(it).optString("type") + ")" }.ifBlank { "keine" })
        return best?.let { it.optString("id") to it.optString("name") }
    }

    private fun errText(r: String) = try { JSONObject(r).let { j -> j.optJSONObject("error")?.optString("message") ?: j.optString("error_description", j.optString("error", r)) } } catch (_: Throwable) { r.take(120) }

    private fun form(vararg kv: Pair<String, String>) = kv.joinToString("&") { URLEncoder.encode(it.first, "UTF-8") + "=" + URLEncoder.encode(it.second, "UTF-8") }

    private fun http(method: String, url: String, token: String?, body: String? = null, form: Boolean = false): Pair<Int, String> = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = method; c.connectTimeout = 10000; c.readTimeout = 10000
        if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("Content-Type", if (form) "application/x-www-form-urlencoded" else "application/json")
            c.outputStream.use { it.write(body.toByteArray()) }
        } else if (method == "PUT") { c.doOutput = true; c.setFixedLengthStreamingMode(0) }
        val code = c.responseCode
        val text = (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: ""
        c.disconnect(); code to text
    } catch (e: Throwable) { -1 to (e.message ?: e.javaClass.simpleName) }
}
