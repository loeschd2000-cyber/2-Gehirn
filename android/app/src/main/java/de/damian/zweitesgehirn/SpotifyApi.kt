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
    private const val SCOPES = "user-modify-playback-state user-read-playback-state user-read-private"
    private fun p(ctx: Context) = ctx.getSharedPreferences("zg_spotify", Context.MODE_PRIVATE)

    fun clientId(ctx: Context) = p(ctx).getString("client_id", "") ?: ""
    fun connected(ctx: Context) = Secure.get(p(ctx), "refresh").isNotBlank()
    fun setClientId(ctx: Context, id: String) = p(ctx).edit().putString("client_id", id.trim()).apply()
    fun disconnect(ctx: Context) = p(ctx).edit().remove("refresh").remove("access").remove("exp").apply()

    private fun b64url(b: ByteArray) = Base64.encodeToString(b, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    /** Öffnet die Spotify-Anmeldung im Browser. */
    fun startLogin(ctx: Context): Boolean {
        val id = clientId(ctx); if (id.isBlank()) return false
        val verifier = b64url(ByteArray(48).also { SecureRandom().nextBytes(it) })
        val challenge = b64url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
        val state = b64url(ByteArray(12).also { SecureRandom().nextBytes(it) })
        p(ctx).edit().putString("verifier", Secure.enc(verifier)).putString("state", state).apply()
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
        val state = uri.getQueryParameter("state"); val saved = p(ctx).getString("state", null)
        if (state == null || saved == null || state != saved) return false to "Anmeldung passt nicht zusammen, bitte nochmal verbinden"
        p(ctx).edit().remove("state").apply()   // jeder Anmelde-Link gilt nur einmal
        val body = form("grant_type" to "authorization_code", "code" to code, "redirect_uri" to REDIRECT,
            "client_id" to clientId(ctx), "code_verifier" to Secure.get(p(ctx), "verifier"))
        val (c, r) = http("POST", "https://accounts.spotify.com/api/token", null, body, form = true)
        if (c != 200) return false to "Anmeldung fehlgeschlagen ($c): ${errText(r)}"
        saveTokens(ctx, JSONObject(r))
        return true to "Spotify ist verbunden"
    }

    private fun saveTokens(ctx: Context, j: JSONObject) {
        val e = p(ctx).edit()
            .putString("access", Secure.enc(j.optString("access_token")))
            .putLong("exp", System.currentTimeMillis() + j.optLong("expires_in", 3600) * 1000 - 60000)
        if (j.optString("refresh_token").isNotBlank()) e.putString("refresh", Secure.enc(j.optString("refresh_token")))
        e.apply()
    }

    private fun token(ctx: Context): String? {
        val acc = Secure.get(p(ctx), "access")
        if (acc.isNotBlank() && System.currentTimeMillis() < p(ctx).getLong("exp", 0)) return acc
        val ref = Secure.get(p(ctx), "refresh"); if (ref.isBlank()) return null
        val (c, r) = http("POST", "https://accounts.spotify.com/api/token", null,
            form("grant_type" to "refresh_token", "refresh_token" to ref, "client_id" to clientId(ctx)), form = true)
        if (c != 200) return null
        saveTokens(ctx, JSONObject(r))
        return Secure.get(p(ctx), "access").ifBlank { null }
    }

    private fun norm(s: String) = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD)
        .replace(Regex("\\p{M}"), "").replace(Regex("[^a-z0-9]+"), " ").trim()

    /**
     * Sucht und spielt ab. Muss in einem Hintergrund-Thread laufen.
     * [log] schreibt ins Protokoll. Rückgabe: (geklappt, Titel oder Fehlertext)
     */
    /** Pause/Weiter/Nächstes/Vorheriges über die Spotify-Schnittstelle (klappt auch mit Bluetooth). Hintergrund-Thread! */
    fun control(ctx: Context, cmd: String, log: (String) -> Unit): Boolean {
        val tok = token(ctx) ?: return false
        val (method, path) = when (cmd) {
            "pause" -> "PUT" to "pause"; "play" -> "PUT" to "play"; "next" -> "POST" to "next"; "previous" -> "POST" to "previous"
            else -> return false
        }
        val (c, r) = http(method, "https://api.spotify.com/v1/me/player/$path", tok, if (method == "PUT" && cmd == "play") "{}" else "")
        log("Spotify-Schnittstelle: $cmd → $c" + if (c !in 200..299) " (${errText(r)})" else "")
        return c in 200..299
    }

    /** Was die Suche zuletzt gefunden hat (Spotify-Adresse, Anzeige) – für den Notweg über die Spotify-App */
    @Volatile var lastFound: Pair<String, String>? = null

    fun play(ctx: Context, query: String, artistHint: String, log: (String) -> Unit): Pair<Boolean, String> {
        lastFound = null
        val tok = token(ctx) ?: return false to "Spotify ist nicht verbunden"
        val nq = norm(query); val na = norm(artistHint)
        val onlyArtist = na.isNotBlank() && na == nq                     // „Musik von Gzuz“
        val trackBy = na.isNotBlank() && na != nq                        // „Blinding Lights von The Weeknd“
        fun search(q: String, types: String): JSONObject? {
            val url = "https://api.spotify.com/v1/search?q=" + URLEncoder.encode(q, "UTF-8") + "&type=$types&limit=10"
            var (c, r) = http("GET", "$url&market=DE", tok)
            if (c == 403 || c == 400) { val r2 = http("GET", url, tok); c = r2.first; r = r2.second }
            if (c != 200) { log("Suche fehlgeschlagen ($c): ${errText(r)}"); return null }
            return try { JSONObject(r) } catch (_: Throwable) { null }
        }
        var body: JSONObject? = null; var label = ""
        fun useArtist(a: JSONObject) { body = JSONObject().put("context_uri", a.optString("uri")); label = a.optString("name") + " (Künstler)" }
        fun useTrack(t: JSONObject) {
            val by = t.optJSONArray("artists")?.optJSONObject(0)?.optString("name") ?: ""
            body = JSONObject().put("uris", org.json.JSONArray().put(t.optString("uri"))); label = t.optString("name") + " – " + by
        }
        fun artistsOf(t: JSONObject): String { val a = t.optJSONArray("artists") ?: return ""; return (0 until a.length()).joinToString(" ") { norm(a.optJSONObject(it)?.optString("name") ?: "") } }

        if (onlyArtist) {
            val js = search(query, "artist") ?: return false to "Spotify-Suche ging nicht"
            val arr = js.optJSONObject("artists")?.optJSONArray("items")
            if (arr != null && arr.length() > 0) {
                val exact = (0 until arr.length()).map { arr.getJSONObject(it) }.firstOrNull { norm(it.optString("name")) == nq }
                useArtist(exact ?: arr.getJSONObject(0))
            }
        } else {
            var js0 = if (trackBy) search("track:\"$query\" artist:\"$artistHint\"", "track") else null
            if (js0 == null || (js0.optJSONObject("tracks")?.optJSONArray("items")?.length() ?: 0) == 0)
                js0 = search(if (trackBy) "$query $artistHint" else query, "artist,track")
            val js = js0 ?: return false to "Spotify-Suche ging nicht"
            val tracks = js.optJSONObject("tracks")?.optJSONArray("items")
            val artists = js.optJSONObject("artists")?.optJSONArray("items")
            val tl = if (tracks == null) emptyList() else (0 until tracks.length()).mapNotNull { tracks.optJSONObject(it) }
            log("Treffer: " + tl.take(3).joinToString(" | ") { it.optString("name") + " – " + (it.optJSONArray("artists")?.optJSONObject(0)?.optString("name") ?: "") }.ifBlank { "keine Lieder" })
            // 1) Künstler heißt genau so → Künstler abspielen
            val exactArtist = if (!trackBy && artists != null) (0 until artists.length()).map { artists.getJSONObject(it) }.firstOrNull { norm(it.optString("name")) == nq } else null
            // 2) Lied, dessen Name genau passt (bei „von …“ auch der Künstler)
            fun score(t: JSONObject): Int {
                val n = norm(t.optString("name")).replace(Regex("\\s*(feat|ft|with)\\b.*$"), "").replace(Regex("\\s*(remaster(ed)?|live|version|edit).*$"), "").trim()
                val a = artistsOf(t)
                var sc = 0
                if (n == nq) sc += 100 else if (n.startsWith(nq) || nq.startsWith(n)) sc += 60 else if (n.contains(nq) || nq.contains(n)) sc += 40
                if (na.isNotBlank()) { if (a.contains(na) || na.split(" ").all { a.contains(it) }) sc += 50 else sc -= 40 }
                else if (nq.split(" ").any { w -> w.length > 2 && a.contains(w) } && nq.split(" ").any { w -> w.length > 2 && n.contains(w) }) sc += 70   // „Lied Künstler“ zusammen gesagt
                return sc
            }
            val best = tl.withIndex().maxByOrNull { (i, t) -> score(t) * 10 - i }?.value
            when {
                exactArtist != null && (best == null || score(best) < 100) -> useArtist(exactArtist)
                best != null && score(best) > 0 -> useTrack(best)
                exactArtist != null -> useArtist(exactArtist)
                tl.isNotEmpty() -> useTrack(tl[0])
                artists != null && artists.length() > 0 -> useArtist(artists.getJSONObject(0))
            }
        }
        val playBody = body?.toString() ?: run { log("Nichts gefunden"); return false to "Auf Spotify nichts zu „$query“ gefunden" }
        log("Gewählt: $label")
        lastFound = (body?.optString("context_uri")?.ifBlank { null } ?: body?.optJSONArray("uris")?.optString(0) ?: "") to label

        // Gerät: dieses Handy. Läuft Spotify nicht, erst im Hintergrund wecken.
        var dev = pickDevice(tok, log)
        if (dev == null) {
            log("Handy ist noch kein Spotify-Gerät → wecke Spotify")
            Music.wakeSpotifyPublic(ctx)
            for (i in 0 until 16) { Thread.sleep(700); dev = pickDevice(tok, null); if (dev != null) break }
        }
        if (dev == null) dev = pickDevice(tok, log, allowOther = true)?.also { log("Nehme anderes Spotify-Gerät: ${it.second}") }
        if (dev == null) { log("Kein Spotify-Gerät gefunden"); return false to "Spotify läuft auf keinem Gerät" }
        log("Gerät: ${dev.second}")
        var (pc, pr) = http("PUT", "https://api.spotify.com/v1/me/player/play?device_id=" + URLEncoder.encode(dev.first, "UTF-8"), tok, playBody)
        if (pc !in 200..299) {
            // Wiedergabe erst auf dieses Handy holen, dann nochmal
            log("Abspielen ging nicht ($pc) → hole Wiedergabe aufs Handy")
            http("PUT", "https://api.spotify.com/v1/me/player", tok, JSONObject().put("device_ids", org.json.JSONArray().put(dev.first)).put("play", false).toString())
            Thread.sleep(600)
            val r2 = http("PUT", "https://api.spotify.com/v1/me/player/play?device_id=" + URLEncoder.encode(dev.first, "UTF-8"), tok, playBody); pc = r2.first; pr = r2.second
        }
        if (pc in 200..299) { log("✓ Spielt: $label"); return true to label }
        log("Abspielen fehlgeschlagen ($pc): ${errText(pr)}")
        return false to "Spotify wollte nicht abspielen ($pc)"
    }

    /** (id, name) des Handys, sonst des aktiven Geräts */
    private fun pickDevice(tok: String, log: ((String) -> Unit)?, allowOther: Boolean = false): Pair<String, String>? {
        val (c, r) = http("GET", "https://api.spotify.com/v1/me/player/devices", tok)
        if (c != 200) { log?.invoke("Geräteliste ging nicht ($c)"); return null }
        val arr = JSONObject(r).optJSONArray("devices") ?: return null
        var best: JSONObject? = null
        for (i in 0 until arr.length()) {
            val d = arr.getJSONObject(i)
            if (d.optString("type").equals("Smartphone", true)) { best = d; break }
        }
        // Andere Geräte (z. B. Echo über Spotify Connect) nur als Notlösung – sonst spielt es woanders statt übers Handy/Bluetooth
        if (best == null && allowOther) for (i in 0 until arr.length()) if (arr.getJSONObject(i).optBoolean("is_active")) best = arr.getJSONObject(i)
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
