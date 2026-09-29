package de.damian.zweitesgehirn

import android.content.Context

object Prefs {
    private fun p(ctx: Context) = ctx.getSharedPreferences("zg", Context.MODE_PRIVATE)
    fun appUrl(ctx: Context): String = p(ctx).getString("url", "") ?: ""
    fun setAppUrl(ctx: Context, url: String) = p(ctx).edit().putString("url", url).apply()
    fun wake(ctx: Context): Boolean = p(ctx).getBoolean("wake", false)
    fun setWake(ctx: Context, on: Boolean) = p(ctx).edit().putBoolean("wake", on).apply()
}
