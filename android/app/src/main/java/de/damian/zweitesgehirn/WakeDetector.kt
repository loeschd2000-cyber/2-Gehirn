package de.damian.zweitesgehirn

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import java.nio.FloatBuffer
import java.util.Random

/**
 * Erkennt "Hey Jarvis" mit den kostenlosen openWakeWord-Modellen (Apache 2.0).
 * Ablauf wie im Original: Audio (16 kHz) -> Mel-Spektrogramm -> Sprach-Merkmale -> Jarvis-Modell.
 * Pro Aufruf von process() kommen 1280 Samples (80 ms), zurück kommt eine Wahrscheinlichkeit 0..1.
 */
class WakeDetector(ctx: Context) : AutoCloseable {
    private val env = OrtEnvironment.getEnvironment()
    private val opts = OrtSession.SessionOptions().apply { setIntraOpNumThreads(1) }
    private val mel = env.createSession(ctx.assets.open("models/melspectrogram.onnx").readBytes(), opts)
    private val emb = env.createSession(ctx.assets.open("models/embedding_model.onnx").readBytes(), opts)
    private val ww = env.createSession(ctx.assets.open("models/hey_jarvis_v0.1.onnx").readBytes(), opts)
    private val melIn = mel.inputNames.first()
    private val embIn = emb.inputNames.first()
    private val wwIn = ww.inputNames.first()

    private val tail = FloatArray(480)          // die letzten 480 Samples des vorherigen Blocks
    private var hasTail = false
    private val melBuf = ArrayDeque<FloatArray>()
    private val feats = ArrayDeque<FloatArray>()

    init { reset() }

    /** Zustand zurücksetzen (z. B. nach einer Pause), damit alte Geräusche nicht nachwirken. */
    fun reset() {
        hasTail = false
        melBuf.clear()
        repeat(76) { melBuf.addLast(FloatArray(32) { 1f }) }
        feats.clear()
        val rnd = Random(0)
        val noise = FloatArray(16000 * 4) { (rnd.nextInt(2000) - 1000).toFloat() }
        val m = melspec(noise)
        var i = 0
        while (i + 76 <= m.size) { feats.addLast(embed(m, i)); i += 8 }
    }

    fun process(chunk: ShortArray): Float {
        val x: FloatArray
        if (hasTail) {
            x = FloatArray(480 + chunk.size)
            System.arraycopy(tail, 0, x, 0, 480)
            for (i in chunk.indices) x[480 + i] = chunk[i].toFloat()
        } else {
            x = FloatArray(chunk.size) { chunk[it].toFloat() }
        }
        for (i in 0 until 480) tail[i] = chunk[chunk.size - 480 + i].toFloat()
        hasTail = true

        for (row in melspec(x)) melBuf.addLast(row)
        while (melBuf.size > 970) melBuf.removeFirst()

        val window = melBuf.toList().takeLast(76).toTypedArray()
        feats.addLast(embed(window, 0))
        while (feats.size > 120) feats.removeFirst()

        return predict()
    }

    private fun melspec(x: FloatArray): Array<FloatArray> {
        OnnxTensor.createTensor(env, FloatBuffer.wrap(x), longArrayOf(1, x.size.toLong())).use { t ->
            mel.run(mapOf(melIn to t)).use { r ->
                val fb = (r.get(0) as OnnxTensor).floatBuffer
                val frames = fb.remaining() / 32
                return Array(frames) { FloatArray(32) { fb.get() / 10f + 2f } }
            }
        }
    }

    private fun embed(m: Array<FloatArray>, start: Int): FloatArray {
        val data = FloatArray(76 * 32)
        for (f in 0 until 76) System.arraycopy(m[start + f], 0, data, f * 32, 32)
        OnnxTensor.createTensor(env, FloatBuffer.wrap(data), longArrayOf(1, 76, 32, 1)).use { t ->
            emb.run(mapOf(embIn to t)).use { r ->
                val fb = (r.get(0) as OnnxTensor).floatBuffer
                return FloatArray(96) { fb.get() }
            }
        }
    }

    private fun predict(): Float {
        val last = feats.toList().takeLast(16)
        val data = FloatArray(16 * 96)
        for (i in last.indices) System.arraycopy(last[i], 0, data, i * 96, 96)
        OnnxTensor.createTensor(env, FloatBuffer.wrap(data), longArrayOf(1, 16, 96)).use { t ->
            ww.run(mapOf(wwIn to t)).use { r ->
                return (r.get(0) as OnnxTensor).floatBuffer.get()
            }
        }
    }

    override fun close() {
        mel.close(); emb.close(); ww.close(); opts.close()
    }
}
