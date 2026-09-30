package de.damian.zweitesgehirn

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log

/**
 * Läuft im Hintergrund (mit Benachrichtigung) und hört auf "Hey Jarvis".
 * Wenn das Wort erkannt wird, holt er die App nach vorne, damit sie zuhört.
 * Während die App selbst das Mikrofon oder die Stimme benutzt, macht der Dienst Pause.
 */
class WakeService : Service() {

    companion object {
        private const val TAG = "ZG-Wake"
        private const val CHANNEL = "wake"
        private const val NOTE_ID = 1
        const val ACTION_STOP = "de.damian.zweitesgehirn.STOP_WAKE"
        const val THRESHOLD = 0.5f
        const val THRESHOLD_SPEAKING = 0.8f   // beim Unterbrechen strenger, damit Jarvis sich nicht selbst hört
        @Volatile var bargeIn = true
        /** Handy ist gerade mit Android Auto verbunden */
        @Volatile var projecting = false

        @Volatile var running = false
        @Volatile private var micBusy = false
        @Volatile private var ttsSpeaking = false     // Handy-Stimme
        @Volatile private var webSpeaking = false     // KI-Stimme aus der Web-App
        private val speaking get() = ttsSpeaking || webSpeaking
        @Volatile private var lastTrigger = 0L
        @Volatile var lastScore = 0f

        fun setMicBusy(b: Boolean) { micBusy = b }
        fun setSpeaking(b: Boolean) { ttsSpeaking = b }
        fun setWebSpeaking(b: Boolean) { webSpeaking = b }

        fun start(ctx: Context) {
            if (ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return
            ctx.startForegroundService(Intent(ctx, WakeService::class.java))
        }
        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, WakeService::class.java)) }
    }

    private var worker: Thread? = null
    @Volatile private var stopFlag = false
    private val main = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Prefs.setWake(this, false)
            MainActivity.current?.bridge?.onWakeStopped()
            stopSelf()
            return START_NOT_STICKY
        }
        try { startInForeground() } catch (e: Exception) {
            // Android 14+: Mikrofon-Dienst darf nicht aus dem Hintergrund starten (z. B. Neustart durch das System)
            Log.e(TAG, "Vordergrund-Dienst nicht erlaubt", e)
            running = false; stopSelf(); return START_NOT_STICKY
        }
        bargeIn = Prefs.bargeIn(this)
        if (worker?.isAlive != true) {
            stopFlag = false
            worker = Thread({ loop() }, "wake-listener").also { it.start() }
        }
        running = true
        return START_NOT_STICKY   // die App startet den Dienst beim Öffnen selbst wieder
    }

    private fun startInForeground() {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "„Hey Jarvis“", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Zeigt an, dass die App auf „Hey Jarvis“ wartet"
                setShowBadge(false)
            })
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val stop = PendingIntent.getService(this, 1, Intent(this, WakeService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val note = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Zweites Gehirn")
            .setContentText("Wartet auf „Hey Jarvis“")
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Ausschalten", stop).build())
            .build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        else startForeground(NOTE_ID, note)
    }

    private fun loop() {
        val detector = try { WakeDetector(this) } catch (e: Throwable) {
            Log.e(TAG, "Modelle konnten nicht geladen werden", e); stopSelf(); return
        }
        val chunk = ShortArray(1280)
        val audio = getSystemService(AudioManager::class.java)
        var rec: AudioRecord? = null
        var wasPaused = true
        try {
            while (!stopFlag) {
                // Pause, solange die App selbst zuhört/spricht oder du telefonierst
                val inCall = audio.mode == AudioManager.MODE_IN_CALL || audio.mode == AudioManager.MODE_IN_COMMUNICATION || audio.mode == AudioManager.MODE_RINGTONE
                // Echo-Unterdrückung auch, wenn Musik läuft – sonst übertönt die Musik „Hey Jarvis“
                val musicOn = try { audio.isMusicActive } catch (_: Throwable) { false }
                val interrupt = (speaking && bargeIn) || (musicOn && !speaking)
                val paused = micBusy || (speaking && !bargeIn) || inCall || System.currentTimeMillis() - lastTrigger < 3000
                if (paused) {
                    rec?.let { try { it.stop() } catch (_: Throwable) {}; it.release() }
                    rec = null; releaseAec()
                    wasPaused = true
                    Thread.sleep(150)
                    continue
                }
                // Beim Unterbrechen eine Aufnahme mit Echo-Unterdrückung nehmen (Jarvis' eigene Stimme wird herausgerechnet)
                if (rec != null && recEcho != interrupt) { try { rec.stop() } catch (_: Throwable) {}; rec.release(); rec = null; releaseAec(); detector.reset() }
                if (rec == null) {
                    if (wasPaused) { detector.reset(); wasPaused = false }
                    val min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
                    val r = try {
                        AudioRecord(if (interrupt) MediaRecorder.AudioSource.VOICE_COMMUNICATION else MediaRecorder.AudioSource.VOICE_RECOGNITION,
                            16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, 1280 * 2 * 4))
                    } catch (e: SecurityException) { Log.e(TAG, "Kein Mikrofon-Recht", e); main.post { stopSelf() }; break }
                    if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); Thread.sleep(1000); continue }
                    if (interrupt) try {
                        if (android.media.audiofx.AcousticEchoCanceler.isAvailable())
                            aec = android.media.audiofx.AcousticEchoCanceler.create(r.audioSessionId)?.apply { enabled = true }
                    } catch (_: Throwable) {}
                    recEcho = interrupt
                    r.startRecording()
                    rec = r
                }
                var n = 0
                while (n < chunk.size && !stopFlag) {
                    val got = rec.read(chunk, n, chunk.size - n)
                    if (got <= 0) break
                    n += got
                }
                if (n < chunk.size) { rec.release(); rec = null; releaseAec(); Thread.sleep(300); continue }
                val score = detector.process(chunk)
                lastScore = score
                if (score >= (if (recEcho && speaking) THRESHOLD_SPEAKING else THRESHOLD) && !micBusy && (!speaking || recEcho)) {
                    lastTrigger = System.currentTimeMillis()
                    rec.stop(); rec.release(); rec = null; wasPaused = true; releaseAec()
                    main.post { onWake() }
                }
            }
        } catch (e: Throwable) {
            Log.e(TAG, "Fehler beim Zuhören", e)
        } finally {
            rec?.let { try { it.stop() } catch (_: Throwable) {}; it.release() }
            releaseAec()
            detector.close()
            running = false
        }
    }

    private var aec: android.media.audiofx.AcousticEchoCanceler? = null
    @Volatile private var recEcho = false
    private fun releaseAec() { try { aec?.release() } catch (_: Throwable) {}; aec = null }

    // Android Auto verbunden? Dann läuft Jarvis im Auto („Hey Jarvis“ antwortet über die Auto-Lautsprecher)
    private var carConn: androidx.car.app.connection.CarConnection? = null
    private val carObserver = androidx.lifecycle.Observer<Int> { type ->
        val proj = type == androidx.car.app.connection.CarConnection.CONNECTION_TYPE_PROJECTION
        projecting = proj
        if (proj) CarBrain.start(applicationContext) else CarBrain.stop()
    }

    override fun onCreate() {
        super.onCreate()
        try { carConn = androidx.car.app.connection.CarConnection(applicationContext).also { it.type.observeForever(carObserver) } } catch (e: Throwable) { Log.e(TAG, "Android-Auto-Erkennung", e) }
    }

    private fun onWake() {
        micBusy = true   // Mikrofon für die App freihalten, bis sie selbst meldet, dass sie fertig ist
        main.postDelayed({
            val listening = (MainActivity.current?.bridge?.isListening() == true) || (MiniActivity.current?.bridge?.isListening() == true) ||
                (CarBrain.bridge?.isListening() == true)
            if (!listening) micBusy = false
        }, 12000)
        try {
            val v = getSystemService(Vibrator::class.java)
            v?.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (_: Throwable) {}
        // Im Auto: Jarvis hört zu und antwortet über die Auto-Lautsprecher (kein Kreis am Handy)
        if (projecting && CarBrain.running) { CarBrain.wake(); return }
        // Ist die große App gerade offen, hört sie direkt zu. Sonst erscheint nur der kleine Kreis.
        val big = MainActivity.current
        if (big != null && big.inForeground) { big.bridge.deliverWake(); return }
        val i = Intent(this, MiniActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("wake", true)
        try { startActivity(i) } catch (e: Throwable) { Log.e(TAG, "Kreis konnte nicht geöffnet werden", e) }
    }

    override fun onDestroy() {
        try { carConn?.type?.removeObserver(carObserver) } catch (_: Throwable) {}
        projecting = false
        stopFlag = true
        worker?.join(800)
        worker = null
        running = false
        super.onDestroy()
    }
}
