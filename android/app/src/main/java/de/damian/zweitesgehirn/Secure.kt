package de.damian.zweitesgehirn

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Geheimes (Bank-Schlüssel, Spotify-/Alexa-Token, Gemini-Schlüssel) verschlüsselt speichern.
 * Der Schlüssel dafür liegt im Sicherheits-Chip des Handys (Android Keystore) und kann nicht ausgelesen werden.
 */
object Secure {
    private const val ALIAS = "zg_secret_v1"
    private const val TAG = "zgs1:"

    @Synchronized private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build())
        return g.generateKey()
    }

    fun enc(plain: String): String {
        if (plain.isEmpty()) return ""
        return try {
            val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, key())
            val out = c.iv + c.doFinal(plain.toByteArray(Charsets.UTF_8))
            TAG + Base64.encodeToString(out, Base64.NO_WRAP)
        } catch (_: Throwable) { plain }   // Notfall: lieber unverschlüsselt als verloren
    }

    fun dec(stored: String?): String {
        if (stored.isNullOrEmpty()) return ""
        if (!stored.startsWith(TAG)) return stored   // alte, noch unverschlüsselte Werte
        return try {
            val all = Base64.decode(stored.substring(TAG.length), Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, all, 0, 12))
            String(c.doFinal(all, 12, all.size - 12), Charsets.UTF_8)
        } catch (_: Throwable) { "" }
    }

    fun get(p: SharedPreferences, k: String): String = dec(p.getString(k, ""))

    /** Einmal beim Start: alte Klartext-Werte verschlüsseln */
    fun migrate(ctx: Context) {
        val jobs = mapOf("zg_bank" to listOf("key", "session"), "zg_spotify" to listOf("access", "refresh", "verifier"),
            "zg" to listOf("vm_token"), "zg_secrets" to emptyList())
        for ((file, keys) in jobs) {
            val p = ctx.getSharedPreferences(file, Context.MODE_PRIVATE); val e = p.edit(); var changed = false
            for (k in keys) { val v = p.getString(k, "") ?: ""; if (v.isNotEmpty() && !v.startsWith(TAG)) { e.putString(k, enc(v)); changed = true } }
            if (changed) e.apply()
        }
    }

    // Kleiner Tresor für die Web-App (z. B. Gemini-Schlüssel)
    private fun vault(ctx: Context) = ctx.getSharedPreferences("zg_secrets", Context.MODE_PRIVATE)
    fun vaultGet(ctx: Context, name: String): String = get(vault(ctx), name)
    fun vaultSet(ctx: Context, name: String, value: String) {
        if (value.isEmpty()) vault(ctx).edit().remove(name).apply() else vault(ctx).edit().putString(name, enc(value)).apply()
    }
}
