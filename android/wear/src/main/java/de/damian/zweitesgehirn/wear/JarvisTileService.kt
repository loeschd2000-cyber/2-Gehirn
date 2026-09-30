package de.damian.zweitesgehirn.wear

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/** Kachel „Jarvis“: großer Knopf „Sprechen“ → App öffnet sich und hört sofort zu */
class JarvisTileService : TileService() {
    private fun text(t: String, size: Float, color: Long) = LayoutElementBuilders.Text.Builder().setText(t)
        .setFontStyle(LayoutElementBuilders.FontStyle.Builder().setSize(sp(size)).setColor(argb(color.toInt())).build()).build()

    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val launch = ActionBuilders.LaunchAction.Builder()
            .setAndroidActivity(ActionBuilders.AndroidActivity.Builder()
                .setPackageName(packageName)
                .setClassName(MainActivity::class.java.name)
                .addKeyToExtraMapping("listen", ActionBuilders.AndroidBooleanExtra.Builder().setValue(true).build())
                .build())
            .build()
        val click = ModifiersBuilders.Clickable.Builder().setId("talk").setOnClick(launch).build()
        val button = LayoutElementBuilders.Box.Builder()
            .setWidth(dp(132f)).setHeight(dp(56f))
            .setModifiers(ModifiersBuilders.Modifiers.Builder()
                .setClickable(click)
                .setBackground(ModifiersBuilders.Background.Builder()
                    .setColor(argb(0xFF3FD6FF.toInt()))
                    .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(28f)).build())
                    .build())
                .build())
            .addContent(text("Sprechen", 18f, 0xFF040B16))
            .build()
        val column = LayoutElementBuilders.Column.Builder()
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .addContent(text("JARVIS", 15f, 0xFF3FD6FF))
            .addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(10f)).build())
            .addContent(button)
            .addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(8f)).build())
            .addContent(text("Frag mich etwas", 12f, 0xFF8FB3C8))
            .build()
        val root = LayoutElementBuilders.Box.Builder().setWidth(expand()).setHeight(expand()).addContent(column).build()
        return Futures.immediateFuture(TileBuilders.Tile.Builder()
            .setResourcesVersion("1")
            .setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(root))
            .build())
    }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        Futures.immediateFuture(ResourceBuilders.Resources.Builder().setVersion("1").build())
}
