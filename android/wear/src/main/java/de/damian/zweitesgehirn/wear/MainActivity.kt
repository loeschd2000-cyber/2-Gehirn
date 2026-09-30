package de.damian.zweitesgehirn.wear

import android.app.Activity
import android.app.NotificationManager
import android.app.RemoteInput
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.wear.input.RemoteInputIntentHelper
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import java.util.Locale

/**
 * Jarvis auf der Uhr: Sprechen-Knopf → Spracherkennung der Uhr → Text ans Handy → Antwort anzeigen (und vorlesen).
 */
class MainActivity : Activity(), MessageClient.OnMessageReceivedListener {

    companion object {
        @Volatile var visible = false
        var lastHeard = ""
        var lastAnswer = "Tippe auf das Mikrofon und frag mich etwas."
        const val REQ_SPEECH = 1
        const val REQ_INPUT = 2
    }

    private val main = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private lateinit var heard: TextView
    private lateinit var answer: TextView
    private lateinit var scroll: ScrollView
    private lateinit var speakBtn: TextView
    private var tts: TextToSpeech? = null
    private var ttsOk = false
    private var waiting = false
    private val prefs by lazy { getSharedPreferences("zg_watch", MODE_PRIVATE) }

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val w = resources.displayMetrics.widthPixels; val h = resources.displayMetrics.heightPixels
        val root = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#040B16")) }
        scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false; isFocusable = true; isFocusableInTouchMode = true }
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding((w * 0.13).toInt(), (h * 0.14).toInt(), (w * 0.13).toInt(), (h * 0.22).toInt())
        }
        status = TextView(this).apply { setTextColor(Color.parseColor("#3FD6FF")); textSize = 12f; gravity = Gravity.CENTER; letterSpacing = 0.08f; typeface = Typeface.DEFAULT_BOLD; text = "JARVIS" }
        val mic = ImageButton(this).apply {
            setImageResource(R.drawable.ic_mic_dark)
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor("#3FD6FF")) }
            contentDescription = "Sprechen"
            setOnClickListener { startSpeech() }
            setOnLongClickListener { startTyping(); true }
        }
        heard = TextView(this).apply { setTextColor(Color.parseColor("#8FB3C8")); textSize = 13f; gravity = Gravity.CENTER; setTypeface(typeface, Typeface.ITALIC) }
        answer = TextView(this).apply { setTextColor(Color.WHITE); textSize = 15f; gravity = Gravity.CENTER; setLineSpacing(0f, 1.1f) }
        speakBtn = TextView(this).apply { textSize = 13f; gravity = Gravity.CENTER; setTextColor(Color.parseColor("#8FB3C8")); setPadding(0, dp(10f), 0, 0)
            setOnClickListener { prefs.edit().putBoolean("speak", !prefs.getBoolean("speak", true)).apply(); updateSpeakBtn(); if (!prefs.getBoolean("speak", true)) tts?.stop() } }
        col.addView(status)
        col.addView(mic, LinearLayout.LayoutParams(dp(62f), dp(62f)).apply { topMargin = dp(8f); bottomMargin = dp(10f) })
        col.addView(heard); col.addView(answer, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(6f) }); col.addView(speakBtn)
        scroll.addView(col); root.addView(scroll)
        setContentView(root)
        heard.text = lastHeard; answer.text = lastAnswer; updateSpeakBtn()
        tts = TextToSpeech(this) { st -> ttsOk = st == TextToSpeech.SUCCESS; if (ttsOk) tts?.language = Locale.GERMANY }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 9)
        handleIntent(intent)
    }

    private fun updateSpeakBtn() { speakBtn.text = if (prefs.getBoolean("speak", true)) "🔊 Vorlesen an" else "🔇 Vorlesen aus" }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); handleIntent(intent) }
    private fun handleIntent(i: Intent?) {
        if (i?.getBooleanExtra("listen", false) == true) { i.removeExtra("listen"); main.postDelayed({ startSpeech() }, 250) }
        i?.getStringExtra("answer")?.let { showAnswer(it, false); i.removeExtra("answer") }
    }

    override fun onResume() {
        super.onResume(); visible = true
        Wearable.getMessageClient(this).addListener(this)
        try { getSystemService(NotificationManager::class.java).cancel(WatchListener.NOTE_ID) } catch (_: Throwable) {}
        heard.text = lastHeard; answer.text = lastAnswer
        scroll.requestFocus()   // Drehkrone scrollt
    }
    override fun onPause() { visible = false; Wearable.getMessageClient(this).removeListener(this); super.onPause() }
    override fun onDestroy() { try { tts?.shutdown() } catch (_: Throwable) {}; super.onDestroy() }

    // ---------- Sprechen ----------
    private fun startSpeech() {
        tts?.stop()
        val i = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "de-DE")
            .putExtra(RecognizerIntent.EXTRA_PROMPT, "Frag Jarvis")
        try { @Suppress("DEPRECATION") startActivityForResult(i, REQ_SPEECH) }
        catch (_: ActivityNotFoundException) { startTyping() }
        catch (_: Throwable) { startTyping() }
    }
    /** Ohne Spracherkennung (oder lange drücken): Eingabe per Tastatur/Diktat der Uhr */
    private fun startTyping() {
        try {
            val i = RemoteInputIntentHelper.createActionRemoteInputIntent()
            RemoteInputIntentHelper.putRemoteInputsExtra(i, listOf(RemoteInput.Builder("q").setLabel("Frag Jarvis").build()))
            @Suppress("DEPRECATION") startActivityForResult(i, REQ_INPUT)
        } catch (e: Throwable) { status.text = "Keine Eingabe möglich" }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (resultCode != RESULT_OK || data == null) return
        val text = when (requestCode) {
            REQ_SPEECH -> data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
            REQ_INPUT -> RemoteInput.getResultsFromIntent(data)?.getCharSequence("q")?.toString()
            else -> null
        }?.trim()
        if (!text.isNullOrBlank()) ask(text)
    }

    // ---------- Ans Handy schicken ----------
    private fun ask(text: String) {
        lastHeard = "„$text“"; heard.text = lastHeard; answer.text = ""; status.text = "SENDET …"; waiting = true
        Wearable.getNodeClient(this).connectedNodes
            .addOnSuccessListener { nodes ->
                val n = nodes.firstOrNull { it.isNearby } ?: nodes.firstOrNull()
                if (n == null) { waiting = false; showAnswer("Dein Handy ist nicht verbunden. Ist Bluetooth an?", false); return@addOnSuccessListener }
                Wearable.getMessageClient(this).sendMessage(n.id, "/jarvis/ask", text.toByteArray(Charsets.UTF_8))
                    .addOnSuccessListener { status.text = "DENKT NACH …" }
                    .addOnFailureListener { waiting = false; showAnswer("Senden ans Handy ging nicht. Ist die Jarvis-App auf dem Handy aktuell?", false) }
                main.postDelayed({ if (waiting) { waiting = false; showAnswer("Das Handy antwortet nicht. Ist Jarvis am Handy eingerichtet und Internet da?", false) } }, 60_000)
            }
            .addOnFailureListener { waiting = false; showAnswer("Keine Verbindung zum Handy.", false) }
    }

    override fun onMessageReceived(ev: MessageEvent) {
        val t = String(ev.data, Charsets.UTF_8)
        main.post {
            when (ev.path) {
                "/jarvis/heard" -> { lastHeard = "„$t“"; heard.text = lastHeard }
                "/jarvis/state" -> status.text = if (t == "bereit") "JARVIS" else t.uppercase(Locale.GERMANY)
                "/jarvis/answer" -> { waiting = false; showAnswer(t, true) }
                "/jarvis/listen" -> main.postDelayed({ startSpeech() }, 900)   // Rückfrage („Soll ich …?“)
            }
        }
    }

    private fun showAnswer(t: String, buzz: Boolean) {
        lastAnswer = t; answer.text = t; status.text = "JARVIS"
        scroll.post { scroll.smoothScrollTo(0, (answer.top - dp(40f)).coerceAtLeast(0)) }
        if (buzz) try { getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createOneShot(60, VibrationEffect.DEFAULT_AMPLITUDE)) } catch (_: Throwable) {}
        if (prefs.getBoolean("speak", true) && ttsOk && visible) tts?.speak(t.replace(Regex("[*_#`>]"), ""), TextToSpeech.QUEUE_FLUSH, null, "a")
    }
}
