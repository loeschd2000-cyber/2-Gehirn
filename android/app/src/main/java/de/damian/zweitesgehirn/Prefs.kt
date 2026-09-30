package de.damian.zweitesgehirn

import android.content.Context

object Prefs {
    private fun p(ctx: Context) = ctx.getSharedPreferences("zg", Context.MODE_PRIVATE)
    fun appUrl(ctx: Context): String = p(ctx).getString("url", "") ?: ""
    fun setAppUrl(ctx: Context, url: String) = p(ctx).edit().putString("url", url).apply()
    fun wake(ctx: Context): Boolean = p(ctx).getBoolean("wake", false)
    fun setWake(ctx: Context, on: Boolean) = p(ctx).edit().putBoolean("wake", on).apply()
    /** „Hey Jarvis“ darf Jarvis beim Sprechen unterbrechen */
    fun bargeIn(ctx: Context): Boolean = p(ctx).getBoolean("barge_in", true)
    fun setBargeIn(ctx: Context, on: Boolean) = p(ctx).edit().putBoolean("barge_in", on).apply()
    /** App-Sperre: beim Öffnen Fingerabdruck / Gesicht / PIN verlangen */
    fun appLock(ctx: Context): Boolean = p(ctx).getBoolean("app_lock", false)
    fun setAppLock(ctx: Context, on: Boolean) = p(ctx).edit().putBoolean("app_lock", on).apply()
}
