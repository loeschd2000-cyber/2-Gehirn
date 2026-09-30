package de.damian.zweitesgehirn

import android.Manifest
import android.annotation.SuppressLint
import android.annotation.TargetApi
import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import android.util.Base64
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Calendar

/**
 * Internet-Anfragen für die Web-App (ohne Browser-Sperren wie CORS) – aber NUR zu diesen Diensten.
 */
object Net {
    private val ALLOW = listOf("webuntis.com", "tankerkoenig.de", "tagesschau.de", "cubefour.de", "dhl.com",
        "smartthings.com", "overpass-api.de", "openstreetmap.org", "open-meteo.com")

    fun allowed(url: String): Boolean {
        if (!url.startsWith("https://")) return false
        val h = try { Uri.parse(url).host ?: "" } catch (_: Throwable) { "" }
        return ALLOW.any { h == it || h.endsWith(".$it") }
    }

    fun req(url: String, method: String = "GET", headers: Map<String, String> = emptyMap(), body: String? = null, timeout: Int = 20000): Pair<Int, String> {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = method; c.connectTimeout = timeout; c.readTimeout = timeout
        c.setRequestProperty("User-Agent", "Jarvis-ZweitesGehirn/1.0 (Android)")
        c.setRequestProperty("Accept-Language", "de-DE,de;q=0.9")
        headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
        if (body != null) { c.doOutput = true; c.outputStream.use { it.write(body.toByteArray()) } }
        val code = c.responseCode
        val txt = try { (if (code in 200..399) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: "" } catch (_: Throwable) { "" }
        c.disconnect()
        return code to txt
    }

    /** Für die Web-App: {status, body} oder {status:0, error} */
    fun forWeb(url: String, method: String, headersJson: String, body: String): JSONObject {
        if (!allowed(url)) return JSONObject().put("status", 0).put("error", "Adresse nicht erlaubt")
        if (method !in listOf("GET", "POST", "PUT", "DELETE")) return JSONObject().put("status", 0).put("error", "Methode nicht erlaubt")
        return try {
            val h = HashMap<String, String>()
            try { val j = JSONObject(headersJson.ifBlank { "{}" }); j.keys().forEach { h[it] = j.optString(it) } } catch (_: Throwable) {}
            val (code, txt) = req(url, method, h, if (method == "GET" || method == "DELETE") null else body)
            JSONObject().put("status", code).put("body", if (txt.length > 900_000) txt.take(900_000) else txt)
        } catch (e: Throwable) { JSONObject().put("status", 0).put("error", e.message ?: "Netzwerkfehler") }
    }
}

/**
 * WebUntis (Stundenplan der Berufsschule): Anmeldung mit deinem Untis-Benutzer, Stunden holen, abmelden.
 * Die Zugangsdaten liegen verschlüsselt im Handy-Tresor (zg_untis).
 */
object Untis {
    fun creds(ctx: Context): JSONObject? = try {
        val j = JSONObject(Secure.vaultGet(ctx, "zg_untis"))
        if (j.optString("server").isBlank() || j.optString("school").isBlank() || j.optString("user").isBlank()) null else j
    } catch (_: Throwable) { null }

    private class UntisErr(val code: Int, msg: String) : Exception(msg)

    private fun rpc(server: String, school: String, method: String, params: Any, session: String?): JSONObject {
        val url = "https://$server/WebUntis/jsonrpc.do?school=" + URLEncoder.encode(school, "UTF-8")
        val body = JSONObject().put("id", "zg").put("method", method).put("params", params).put("jsonrpc", "2.0").toString()
        val h = mutableMapOf("Content-Type" to "application/json")
        if (session != null) h["Cookie"] = "JSESSIONID=$session; schoolname=\"_" + Base64.encodeToString(school.toByteArray(), Base64.NO_WRAP) + "\""
        val (code, txt) = Net.req(url, "POST", h, body, 12000)
        val j = try { JSONObject(txt) } catch (_: Throwable) { throw UntisErr(code, "Untis antwortet nicht richtig (Fehler $code). Stimmt der Server?") }
        j.optJSONObject("error")?.let { e ->
            val c = e.optInt("code")
            throw UntisErr(c, when (c) {
                -8504 -> "Benutzername oder Passwort bei Untis falsch"
                -8500, -8501 -> "Schule bei Untis nicht gefunden"
                -8509 -> "Untis erlaubt dir diesen Stundenplan nicht"
                -8520 -> "Untis-Anmeldung abgelaufen"
                else -> e.optString("message", "Untis-Fehler $c")
            })
        }
        return j
    }

    /** Stunden von..bis (JJJJMMTT). Antwort: {ok, lessons:[…]} oder {ok:false, msg} */
    fun range(ctx: Context, from: Int, to: Int): JSONObject {
        val c = creds(ctx) ?: return JSONObject().put("ok", false).put("msg", "WebUntis ist noch nicht eingerichtet")
        val server = c.optString("server"); val school = c.optString("school")
        return try {
            val auth = rpc(server, school, "authenticate",
                JSONObject().put("user", c.optString("user")).put("password", c.optString("pass")).put("client", "Jarvis"), null).getJSONObject("result")
            val sid = auth.getString("sessionId")
            try {
                fun get(type: Int, id: Int): JSONArray {
                    val opts = JSONObject().put("element", JSONObject().put("id", id).put("type", type))
                        .put("startDate", from).put("endDate", to)
                        .put("showSubstText", true).put("showInfo", true).put("showLsText", true)
                        .put("subjectFields", JSONArray().put("name").put("longname"))
                        .put("teacherFields", JSONArray().put("name"))
                        .put("roomFields", JSONArray().put("name"))
                        .put("klasseFields", JSONArray().put("name"))
                    return rpc(server, school, "getTimetable", JSONObject().put("options", opts), sid).optJSONArray("result") ?: JSONArray()
                }
                val pid = auth.optInt("personId", 0); val kid = auth.optInt("klasseId", 0)
                val lessons = try {
                    if (pid > 0) get(auth.optInt("personType", 5), pid) else if (kid > 0) get(1, kid) else JSONArray()
                } catch (e: UntisErr) { if (kid > 0) get(1, kid) else throw e }
                JSONObject().put("ok", true).put("lessons", lessons)
            } finally { try { rpc(server, school, "logout", JSONObject(), sid) } catch (_: Throwable) {} }
        } catch (e: Throwable) { JSONObject().put("ok", false).put("msg", e.message ?: "Untis-Fehler") }
    }

    /** Schule suchen (wie in der Untis-App) */
    fun search(q: String): JSONObject = try {
        val body = JSONObject().put("id", "zg").put("method", "searchSchool")
            .put("params", JSONArray().put(JSONObject().put("search", q))).put("jsonrpc", "2.0").toString()
        val (_, txt) = Net.req("https://mobile.webuntis.com/ms/schoolquery2", "POST", mapOf("Content-Type" to "application/json"), body)
        val j = JSONObject(txt)
        val err = j.optJSONObject("error")
        if (err != null) JSONObject().put("ok", false).put("msg", if (err.optInt("code") == -6003) "Zu viele Treffer – gib den Namen genauer ein" else err.optString("message", "Fehler"))
        else {
            val out = JSONArray(); val s = j.optJSONObject("result")?.optJSONArray("schools") ?: JSONArray()
            for (i in 0 until minOf(s.length(), 15)) { val o = s.getJSONObject(i)
                out.put(JSONObject().put("server", o.optString("server")).put("school", o.optString("loginName")).put("name", o.optString("displayName")).put("address", o.optString("address"))) }
            JSONObject().put("ok", true).put("schools", out)
        }
    } catch (e: Throwable) { JSONObject().put("ok", false).put("msg", e.message ?: "Fehler") }

    private fun ymd(c: Calendar) = c.get(Calendar.YEAR) * 10000 + (c.get(Calendar.MONTH) + 1) * 100 + c.get(Calendar.DAY_OF_MONTH)
    private fun hm(t: Int) = "%d:%02d".format(t / 100, t % 100)

    /** Für die Benachrichtigungen: Ausfälle/Änderungen an einem Tag (0 = heute, 1 = morgen) als Textzeilen */
    fun changes(ctx: Context, dayOffset: Int): List<String> {
        if (creds(ctx) == null) return emptyList()
        val d = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, dayOffset) }
        val r = range(ctx, ymd(d), ymd(d))
        if (!r.optBoolean("ok")) return emptyList()
        val ls = r.optJSONArray("lessons") ?: return emptyList()
        val out = ArrayList<String>(); val word = if (dayOffset == 0) "Heute" else "Morgen"
        val list = (0 until ls.length()).map { ls.getJSONObject(it) }.sortedBy { it.optInt("startTime") }
        for (l in list) {
            val code = l.optString("code")
            val su = l.optJSONArray("su")?.optJSONObject(0)?.let { it.optString("longname").ifBlank { it.optString("name") } } ?: "Stunde"
            if (code == "cancelled") out += "🏫 $word ${hm(l.optInt("startTime"))}: $su fällt aus"
            else if (code == "irregular" || l.optString("substText").isNotBlank()) out += "🏫 $word ${hm(l.optInt("startTime"))}: $su – Änderung" + (l.optString("substText").takeIf { it.isNotBlank() }?.let { " ($it)" } ?: "")
        }
        if (list.isNotEmpty() && list.all { it.optString("code") == "cancelled" }) return listOf("🏫 $word fällt die ganze Schule aus!")
        return out.take(4)
    }
}

/** Samsung Health über Health Connect (Schritte, Schlaf). Ab Android 14 im System eingebaut. */
object Health {
    val PERMS = arrayOf("android.permission.health.READ_STEPS", "android.permission.health.READ_SLEEP")
    fun available() = Build.VERSION.SDK_INT >= 34
    fun granted(ctx: Context) = available() && PERMS.all { ctx.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }

    fun today(ctx: Context, cb: (JSONObject) -> Unit) {
        if (!available()) { cb(JSONObject().put("ok", false).put("msg", "Braucht Android 14 oder neuer")); return }
        if (!granted(ctx)) { cb(JSONObject().put("ok", false).put("msg", "perm")); return }
        try { read34(ctx, cb) } catch (e: Throwable) { cb(JSONObject().put("ok", false).put("msg", e.message ?: "Fehler")) }
    }

    @TargetApi(34)
    private fun read34(ctx: Context, cb: (JSONObject) -> Unit) {
        val hcm = ctx.getSystemService(android.health.connect.HealthConnectManager::class.java)
            ?: run { cb(JSONObject().put("ok", false).put("msg", "Health Connect fehlt")); return }
        val ex = java.util.concurrent.Executors.newSingleThreadExecutor()
        val zone = java.time.ZoneId.systemDefault()
        val now = java.time.Instant.now()
        val dayStart = java.time.LocalDate.now(zone).atStartOfDay(zone).toInstant()
        val out = JSONObject().put("ok", true)
        fun sleep() {
            val req = android.health.connect.ReadRecordsRequestUsingFilters.Builder(android.health.connect.datatypes.SleepSessionRecord::class.java)
                .setTimeRangeFilter(android.health.connect.TimeInstantRangeFilter.Builder().setStartTime(now.minus(java.time.Duration.ofHours(20))).setEndTime(now).build())
                .build()
            hcm.readRecords(req, ex, object : android.os.OutcomeReceiver<android.health.connect.ReadRecordsResponse<android.health.connect.datatypes.SleepSessionRecord>, android.health.connect.HealthConnectException> {
                override fun onResult(r: android.health.connect.ReadRecordsResponse<android.health.connect.datatypes.SleepSessionRecord>) {
                    var ms = 0L; var s: java.time.Instant? = null; var e: java.time.Instant? = null
                    for (x in r.records) {
                        ms += java.time.Duration.between(x.startTime, x.endTime).toMillis()
                        if (s == null || x.startTime.isBefore(s)) s = x.startTime
                        if (e == null || x.endTime.isAfter(e)) e = x.endTime
                    }
                    if (ms > 0) out.put("sleepMin", ms / 60000).put("sleepStart", s!!.toEpochMilli()).put("sleepEnd", e!!.toEpochMilli())
                    cb(out); ex.shutdown()
                }
                override fun onError(err: android.health.connect.HealthConnectException) { out.put("sleepErr", err.message ?: ""); cb(out); ex.shutdown() }
            })
        }
        val filter = android.health.connect.TimeInstantRangeFilter.Builder().setStartTime(dayStart).setEndTime(now).build()
        val stepsReq = android.health.connect.AggregateRecordsRequest.Builder<Long>(filter)
            .addAggregationType(android.health.connect.datatypes.StepsRecord.STEPS_COUNT_TOTAL).build()
        hcm.aggregate(stepsReq, ex, object : android.os.OutcomeReceiver<android.health.connect.AggregateRecordsResponse<Long>, android.health.connect.HealthConnectException> {
            override fun onResult(r: android.health.connect.AggregateRecordsResponse<Long>) {
                out.put("steps", r.get(android.health.connect.datatypes.StepsRecord.STEPS_COUNT_TOTAL) ?: 0L); sleep()
            }
            override fun onError(err: android.health.connect.HealthConnectException) { out.put("stepsErr", err.message ?: ""); sleep() }
        })
    }
}

/** Handy-Funktionen: Taschenlampe, Nicht stören, Klingelton, Akku */
object Device {
    fun torch(ctx: Context, on: Boolean): String = try {
        val cm = ctx.getSystemService(CameraManager::class.java)
        val id = cm.cameraIdList.firstOrNull { cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true }
        if (id == null) "Dein Handy hat keine Taschenlampe gefunden" else { cm.setTorchMode(id, on); "ok" }
    } catch (e: Throwable) { "Taschenlampe geht gerade nicht (${e.message})" }

    private fun policyOk(ctx: Context): Boolean {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.isNotificationPolicyAccessGranted) return true
        try { ctx.startActivity(Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Throwable) {}
        return false
    }

    /** on=true: Nicht stören an (nur wichtige Anrufe/Wecker), false: aus. „need“ = Recht fehlt (Einstellungen wurden geöffnet) */
    fun dnd(ctx: Context, on: Boolean): String {
        if (!policyOk(ctx)) return "need"
        return try { ctx.getSystemService(NotificationManager::class.java).setInterruptionFilter(if (on) NotificationManager.INTERRUPTION_FILTER_PRIORITY else NotificationManager.INTERRUPTION_FILTER_ALL); "ok" } catch (e: Throwable) { e.message ?: "Fehler" }
    }

    /** mode: silent | vibrate | normal */
    fun ringer(ctx: Context, mode: String): String {
        val am = ctx.getSystemService(AudioManager::class.java)
        return try {
            when (mode) {
                "silent" -> { if (!policyOk(ctx)) return "need"; am.ringerMode = AudioManager.RINGER_MODE_SILENT }
                "vibrate" -> am.ringerMode = AudioManager.RINGER_MODE_VIBRATE
                else -> { if (am.ringerMode == AudioManager.RINGER_MODE_SILENT && !policyOk(ctx)) return "need"; am.ringerMode = AudioManager.RINGER_MODE_NORMAL }
            }
            "ok"
        } catch (e: Throwable) { if (e is SecurityException) { policyOk(ctx); "need" } else e.message ?: "Fehler" }
    }

    fun battery(ctx: Context): JSONObject {
        val bm = ctx.getSystemService(BatteryManager::class.java)
        val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val charging = bm.isCharging
        val left = if (Build.VERSION.SDK_INT >= 28 && charging) bm.computeChargeTimeRemaining() else -1L
        return JSONObject().put("pct", pct).put("charging", charging).put("fullInMin", if (left > 0) left / 60000 else -1)
    }
}

/** Standort: aktueller Ort (für Tankstellen, Orts-Erinnerungen) */
object Loc {
    fun has(ctx: Context) = ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    fun hasFine(ctx: Context) = ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    /** Geofences brauchen genauen Standort und ab Android 10 „Immer erlauben“ */
    fun canFence(ctx: Context) = hasFine(ctx) && (Build.VERSION.SDK_INT < 29 || hasBackground(ctx))
    fun hasBackground(ctx: Context) = ctx.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun current(ctx: Context, cb: (JSONObject) -> Unit) {
        if (!has(ctx)) { cb(JSONObject().put("ok", false).put("msg", "perm")); return }
        try {
            val c = LocationServices.getFusedLocationProviderClient(ctx)
            c.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, null)
                .addOnSuccessListener { l ->
                    if (l != null) cb(JSONObject().put("ok", true).put("lat", l.latitude).put("lng", l.longitude))
                    else c.lastLocation.addOnSuccessListener { o -> cb(if (o != null) JSONObject().put("ok", true).put("lat", o.latitude).put("lng", o.longitude) else JSONObject().put("ok", false).put("msg", "Kein Standort (GPS aus?)")) }
                        .addOnFailureListener { cb(JSONObject().put("ok", false).put("msg", "Kein Standort")) }
                }
                .addOnFailureListener { e -> cb(JSONObject().put("ok", false).put("msg", e.message ?: "Kein Standort")) }
        } catch (e: Throwable) { cb(JSONObject().put("ok", false).put("msg", e.message ?: "Kein Standort")) }
    }
}

/**
 * Orts-Erinnerungen: „Erinner mich beim Edeka an Milch“ – meldet sich, sobald du an einem der Orte ankommst.
 * Jede Erinnerung (Gruppe) kann mehrere Orte haben (z. B. alle Edekas in der Nähe) und löscht sich nach dem Auslösen.
 */
object Places {
    private fun p(ctx: Context) = ctx.getSharedPreferences("zg_places", Context.MODE_PRIVATE)
    @Synchronized fun list(ctx: Context): JSONArray = try { JSONArray(p(ctx).getString("list", "[]")) } catch (_: Throwable) { JSONArray() }
    @Synchronized private fun save(ctx: Context, a: JSONArray) { p(ctx).edit().putString("list", a.toString()).apply() }

    private fun pending(ctx: Context) = PendingIntent.getBroadcast(ctx, 8300, Intent(ctx, GeofenceReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0))

    /** spots: [{name, lat, lng}] – Rückgabe „ok“, „need-bg“ (Standort „Immer erlauben“ fehlt) oder Fehler */
    @SuppressLint("MissingPermission")
    fun add(ctx: Context, text: String, place: String, spots: JSONArray, radius: Float): String {
        if (!Loc.hasFine(ctx)) return "perm"
        val a = list(ctx)
        val used = (0 until a.length()).sumOf { a.getJSONObject(it).optJSONArray("spots")?.length() ?: 0 }
        val n = minOf(spots.length(), 20, 95 - used)
        if (n <= 0) return "Zu viele Orts-Erinnerungen – lösch erst ein paar"
        val gid = "g" + (System.currentTimeMillis() % 10_000_000)
        val fences = ArrayList<Geofence>(); val keep = JSONArray()
        for (i in 0 until n) {
            val s = spots.getJSONObject(i)
            fences += Geofence.Builder().setRequestId("$gid#$i")
                .setCircularRegion(s.getDouble("lat"), s.getDouble("lng"), radius.coerceIn(100f, 1000f))
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER).build()
            keep.put(s)
        }
        return try {
            a.put(JSONObject().put("id", gid).put("text", text).put("place", place).put("radius", radius.toDouble()).put("spots", keep).put("added", System.currentTimeMillis()))
            save(ctx, a)
            // Ohne „Immer erlauben“ lehnt Android Geofences ab – dann erst scharf schalten, wenn das Recht da ist (rearm beim Öffnen der App)
            if (!Loc.canFence(ctx)) return "need-bg"
            val req = GeofencingRequest.Builder().setInitialTrigger(0).addGeofences(fences).build()
            LocationServices.getGeofencingClient(ctx).addGeofences(req, pending(ctx))
                .addOnFailureListener { e -> android.util.Log.w("Jarvis", "Geofence fehlgeschlagen: ${e.message}") }
            "ok"
        } catch (e: Throwable) { e.message ?: "Fehler" }
    }

    fun remove(ctx: Context, gid: String) {
        val a = list(ctx); val keep = JSONArray(); val ids = ArrayList<String>()
        for (i in 0 until a.length()) { val o = a.getJSONObject(i)
            if (gid == "*" || o.optString("id") == gid) { val n = o.optJSONArray("spots")?.length() ?: 0; for (k in 0 until n) ids += o.optString("id") + "#" + k } else keep.put(o) }
        save(ctx, keep)
        if (ids.isNotEmpty()) try { LocationServices.getGeofencingClient(ctx).removeGeofences(ids) } catch (_: Throwable) {}
    }

    /** Nach dem Neustart sind alle Geofences weg – neu anmelden */
    @SuppressLint("MissingPermission")
    fun rearm(ctx: Context) {
        if (!Loc.canFence(ctx)) return
        val a = list(ctx); val fences = ArrayList<Geofence>()
        for (i in 0 until a.length()) { val o = a.getJSONObject(i); val s = o.optJSONArray("spots") ?: continue
            for (k in 0 until s.length()) { val x = s.getJSONObject(k)
                fences += Geofence.Builder().setRequestId(o.optString("id") + "#" + k)
                    .setCircularRegion(x.getDouble("lat"), x.getDouble("lng"), o.optDouble("radius", 150.0).toFloat())
                    .setExpirationDuration(Geofence.NEVER_EXPIRE).setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER).build() } }
        if (fences.isNotEmpty()) try { LocationServices.getGeofencingClient(ctx).addGeofences(GeofencingRequest.Builder().setInitialTrigger(0).addGeofences(fences).build(), pending(ctx)) } catch (_: Throwable) {}
    }

    fun triggered(ctx: Context, requestIds: List<String>) {
        val groups = requestIds.map { it.substringBefore('#') }.toSet()
        val a = list(ctx)
        for (i in 0 until a.length()) {
            val o = a.getJSONObject(i); if (o.optString("id") !in groups) continue
            val k = requestIds.first { it.startsWith(o.optString("id") + "#") }.substringAfter('#').toIntOrNull() ?: 0
            val spot = o.optJSONArray("spots")?.optJSONObject(k)?.optString("name")?.ifBlank { null } ?: o.optString("place")
            Notes.show(ctx, "places", "Orts-Erinnerungen", 8400 + (o.optString("id").hashCode() and 0x3ff),
                "📍 Du bist bei: $spot", "Erinnerung: " + o.optString("text"))
            remove(ctx, o.optString("id"))
        }
    }
}

class GeofenceReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == "android.intent.action.QUICKBOOT_POWERON") {
            Places.rearm(ctx); FuelWatch.arm(ctx); return
        }
        val ev = GeofencingEvent.fromIntent(intent) ?: return
        if (ev.hasError()) return
        if (ev.geofenceTransition != Geofence.GEOFENCE_TRANSITION_ENTER) return
        val ids = ev.triggeringGeofences?.map { it.requestId } ?: return
        Places.triggered(ctx, ids)
    }
}

/**
 * Tank-Alarm (Tankerkönig): „Sag mir Bescheid, wenn Diesel unter 1,60 kostet“ – schaut alle ~2 Stunden nach.
 */
object FuelWatch {
    private fun p(ctx: Context) = ctx.getSharedPreferences("zg_fuel", Context.MODE_PRIVATE)
    fun get(ctx: Context): JSONObject? = try { JSONObject(p(ctx).getString("w", "") ?: "") } catch (_: Throwable) { null }
    fun set(ctx: Context, limit: Double, type: String, lat: Double, lng: Double) {
        p(ctx).edit().putString("w", JSONObject().put("limit", limit).put("type", type).put("lat", lat).put("lng", lng).toString()).apply(); arm(ctx)
    }
    fun clear(ctx: Context) { p(ctx).edit().remove("w").apply(); arm(ctx) }
    private fun pending(ctx: Context) = PendingIntent.getBroadcast(ctx, 8500, Intent(ctx, FuelReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    fun arm(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java); am.cancel(pending(ctx))
        if (get(ctx) == null) return
        am.setInexactRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + 20 * 60_000L, AlarmManager.INTERVAL_HOUR * 2, pending(ctx))
    }
    /** Günstigste offene Tankstellen in der Nähe (sortiert) */
    fun cheapest(ctx: Context, lat: Double, lng: Double, type: String, rad: Int = 10): JSONArray? {
        val key = Secure.vaultGet(ctx, "zg_tk_key"); if (key.isBlank()) return null
        val (code, txt) = Net.req("https://creativecommons.tankerkoenig.de/json/list.php?lat=$lat&lng=$lng&rad=$rad&sort=price&type=$type&apikey=" + Uri.encode(key))
        if (code !in 200..299) return null
        val j = try { JSONObject(txt) } catch (_: Throwable) { return null }
        return if (j.optBoolean("ok")) j.optJSONArray("stations") else null
    }
    fun check(ctx: Context) {
        val w = get(ctx) ?: return
        val st = cheapest(ctx, w.optDouble("lat"), w.optDouble("lng"), w.optString("type", "diesel")) ?: return
        for (i in 0 until st.length()) {
            val s = st.getJSONObject(i); if (!s.optBoolean("isOpen", true)) continue
            val price = s.optDouble("price", 0.0); if (price <= 0) continue
            if (price <= w.optDouble("limit")) {
                val name = (s.optString("brand").ifBlank { s.optString("name") }) + " " + s.optString("place")
                val label = when (w.optString("type", "diesel")) { "e5" -> "Super E5"; "e10" -> "Super E10"; else -> "Diesel" }
                Notes.show(ctx, "fuel", "Tank-Alarm", 8501, "⛽ $label für ${"%.3f".format(price).replace('.', ',')} €",
                    "$name (${"%.1f".format(s.optDouble("dist")).replace('.', ',')} km) – deine Grenze war ${"%.2f".format(w.optDouble("limit")).replace('.', ',')} €.")
                clear(ctx)
            }
            return
        }
    }
}

class FuelReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val r = goAsync()
        Thread { try { FuelWatch.check(ctx) } catch (_: Throwable) {} finally { r.finish() } }.start()
    }
}
