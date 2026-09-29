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

        @Volatile var running = false
        @Volatile private var micBusy = false
        @Volatile private var speaking = false
        @Volatile private var lastTrigger = 0L
        @Volatile var lastScore = 0f

        fun setMicBusy(b: Boolean) { micBusy = b }
        fun setSpeaking(b: Boolean) { speaking = b }

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
            MainActivity.current?.onWakeStoppedFromNotification()
            stopSelf()
            return START_NOT_STICKY
        }
        startInForeground()
        if (worker == null) {
            stopFlag = false
            worker = Thread({ loop() }, "wake-listener").also { it.start() }
        }
        running = true
        return START_STICKY
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
        var rec: AudioRecord? = null
        var wasPaused = true
        try {
            while (!stopFlag) {
                val paused = micBusy || speaking || System.currentTimeMillis() - lastTrigger < 3000
                if (paused) {
                    rec?.let { try { it.stop() } catch (_: Throwable) {}; it.release() }
                    rec = null
                    wasPaused = true
                    Thread.sleep(150)
                    continue
                }
                if (rec == null) {
                    if (wasPaused) { detector.reset(); wasPaused = false }
                    val min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
                    val r = try {
                        AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000, AudioFormat.CHANNEL_IN_MONO,
                            AudioFormat.ENCODING_PCM_16BIT, maxOf(min, 1280 * 2 * 4))
                    } catch (e: SecurityException) { Log.e(TAG, "Kein Mikrofon-Recht", e); break }
                    if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); Thread.sleep(1000); continue }
                    r.startRecording()
                    rec = r
                }
                var n = 0
                while (n < chunk.size && !stopFlag) {
                    val got = rec.read(chunk, n, chunk.size - n)
                    if (got <= 0) break
                    n += got
                }
                if (n < chunk.size) { rec.release(); rec = null; Thread.sleep(300); continue }
                val score = detector.process(chunk)
                lastScore = score
                if (score >= THRESHOLD && !micBusy && !speaking) {
                    lastTrigger = System.currentTimeMillis()
                    rec.stop(); rec.release(); rec = null; wasPaused = true
                    main.post { onWake() }
                }
            }
        } catch (e: Throwable) {
            Log.e(TAG, "Fehler beim Zuhören", e)
        } finally {
            rec?.let { try { it.stop() } catch (_: Throwable) {}; it.release() }
            detector.close()
        }
    }

    private fun onWake() {
        micBusy = true   // Mikrofon für die App freihalten, bis sie selbst meldet, dass sie fertig ist
        main.postDelayed({ if (MainActivity.current?.isListeningNative() != true) micBusy = false }, 12000)
        try {
            val v = getSystemService(Vibrator::class.java)
            v?.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE))
        } catch (_: Throwable) {}
        val i = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("wake", true)
        try { startActivity(i) } catch (e: Throwable) { Log.e(TAG, "App konnte nicht geöffnet werden", e) }
    }

    override fun onDestroy() {
        stopFlag = true
        worker?.join(800)
        worker = null
        running = false
        super.onDestroy()
    }
}
