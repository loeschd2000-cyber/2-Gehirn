package de.damian.zweitesgehirn

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlin.math.sqrt

/**
 * Nimmt auf, bis du fertig gesprochen hast (Pause erkannt), für die genaue KI-Erkennung.
 * Ergebnis ist eine WAV-Datei (16 kHz, mono) als Base64-Text.
 */
class VoiceRecorder(
    private val onEvent: (type: String, sid: Int, extra: String?) -> Unit
) {
    @Volatile private var sid = 0
    @Volatile private var flag = 0          // 0 = läuft, 1 = fertig (auswerten), 2 = abbrechen
    @Volatile private var result: Pair<Int, String>? = null
    /** Nimmt gerade auf (dann darf „Hey Jarvis“ nicht mithören) */
    @Volatile var active = false
        private set

    fun start(pauseMs: Int, maxMs: Int): Int {
        val my = ++sid; flag = 0; result = null; active = true
        WakeService.setMicBusy(true)
        Thread({ loop(my, pauseMs.coerceIn(700, 5000), maxMs.coerceIn(3000, 60000)) }, "zg-rec").start()
        return my
    }
    fun stop(s: Int) { if (s == sid) flag = 1 }
    fun abort(s: Int) { if (s == sid) flag = 2 }
    fun abortAll() { flag = 2; sid++; if (active) { active = false; WakeService.setMicBusy(false) } }
    /** Holt die Aufnahme ab (nur einmal) */
    fun take(s: Int): String { val r = result; return if (r != null && r.first == s) { result = null; r.second } else "" }

    private fun loop(my: Int, pauseMs: Int, maxMs: Int) {
        val rate = 16000
        val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val r = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, 3200 * 4))
        } catch (_: SecurityException) { finish(my, "error", "not-allowed"); return } catch (_: Throwable) { finish(my, "error", "audio-capture"); return }
        if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); finish(my, "error", "audio-capture"); return }
        val pcm = ByteArrayOutputStream()
        val frame = ShortArray(480)     // 30 ms
        var noise = Double.MAX_VALUE; var frames = 0; var speech = false; var lastVoice = 0L
        val t0 = System.currentTimeMillis()
        var aborted = false
        try {
            r.startRecording()
            onEvent("start", my, null)
            while (true) {
                if (sid != my || flag == 2) { aborted = true; break }
                if (flag == 1) break
                val n = r.read(frame, 0, frame.size)
                if (n <= 0) break
                var sum = 0.0
                for (i in 0 until n) { val v = frame[i].toInt(); sum += v * v; pcm.write(v and 0xff); pcm.write((v shr 8) and 0xff) }
                val rms = sqrt(sum / n)
                frames++
                if (frames <= 8) noise = minOf(noise, rms)          // Grundrauschen der ersten Viertelsekunde
                val thr = maxOf(350.0, (if (noise == Double.MAX_VALUE) 0.0 else noise) * 3.0)
                val now = System.currentTimeMillis()
                if (frames > 3 && rms > thr) { if (!speech) { speech = true; onEvent("speech", my, null) }; lastVoice = now }
                if (!speech && now - t0 > 7000) break               // nichts gesagt
                if (speech && now - lastVoice > pauseMs) break       // fertig gesprochen
                if (now - t0 > maxMs) break
            }
        } catch (_: Throwable) {
        } finally {
            try { r.stop() } catch (_: Throwable) {}
            r.release()
        }
        if (aborted) { finish(my, "end", "aborted"); return }
        if (!speech) { finish(my, "end", "no-speech"); return }
        result = my to Base64.encodeToString(wav(pcm.toByteArray(), rate), Base64.NO_WRAP)
        finish(my, "end", "ok")
    }

    private fun finish(my: Int, type: String, extra: String?) {
        if (sid == my) {   // nur die neueste Aufnahme gibt das Mikrofon frei
            active = false
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ if (!active && sid == my) WakeService.setMicBusy(false) }, 400)
        }
        onEvent(type, my, extra)
    }

    private fun wav(data: ByteArray, rate: Int): ByteArray {
        val out = ByteArrayOutputStream(44 + data.size)
        fun i32(v: Int) { out.write(v and 0xff); out.write((v shr 8) and 0xff); out.write((v shr 16) and 0xff); out.write((v shr 24) and 0xff) }
        fun i16(v: Int) { out.write(v and 0xff); out.write((v shr 8) and 0xff) }
        out.write("RIFF".toByteArray()); i32(36 + data.size); out.write("WAVE".toByteArray())
        out.write("fmt ".toByteArray()); i32(16); i16(1); i16(1); i32(rate); i32(rate * 2); i16(2); i16(16)
        out.write("data".toByteArray()); i32(data.size); out.write(data)
        return out.toByteArray()
    }
}
