package com.dhruvchheda.quotify

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class WidgetSyncModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "WidgetSync"

    @ReactMethod
    fun updateWidgetQuote(
        quote: String,
        author: String,
        sourceMode: String,
        timestamp: String?,
        datasetJson: String?,
        promise: Promise
    ) {
        try {
            val sharedPreferences = reactContext.getSharedPreferences("QuotifyWidget", Context.MODE_PRIVATE)
            sharedPreferences.edit()
                .putString(QuoteWidgetProvider.WIDGET_QUOTE_KEY, quote)
                .putString(QuoteWidgetProvider.WIDGET_AUTHOR_KEY, author)
                .putLong(QuoteWidgetProvider.WIDGET_LAST_UPDATE_KEY, System.currentTimeMillis())
                .putString(QuoteWidgetProvider.WIDGET_SOURCE_MODE_KEY, sourceMode)
                .putString(QuoteWidgetProvider.WIDGET_LAST_UPDATE_ISO_KEY, timestamp ?: "")
                .putString(QuoteWidgetProvider.WIDGET_DATASET_CACHE_KEY, datasetJson ?: "")
                .apply()

            refreshAllWidgets(quote, author)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("WIDGET_SYNC_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getCurrentWidgetQuote(promise: Promise) {
        try {
            val sharedPreferences = reactContext.getSharedPreferences("QuotifyWidget", Context.MODE_PRIVATE)
            val quote = sharedPreferences.getString(QuoteWidgetProvider.WIDGET_QUOTE_KEY, null)
            val author = sharedPreferences.getString(QuoteWidgetProvider.WIDGET_AUTHOR_KEY, null)
            val sourceMode = sharedPreferences.getString(QuoteWidgetProvider.WIDGET_SOURCE_MODE_KEY, "local")
            val timestamp = sharedPreferences.getString(QuoteWidgetProvider.WIDGET_LAST_UPDATE_ISO_KEY, null)

            if (quote.isNullOrBlank() || author.isNullOrBlank()) {
                promise.resolve(null)
                return
            }

            val map = Arguments.createMap().apply {
                putString("content", quote)
                putString("author", author)
                putString("sourceMode", sourceMode)
                putString("timestamp", timestamp)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("WIDGET_READ_ERROR", e.message, e)
        }
    }

    private fun refreshAllWidgets(quote: String, author: String) {
        val appWidgetManager = AppWidgetManager.getInstance(reactContext)
        val componentName = ComponentName(reactContext, QuoteWidgetProvider::class.java)
        val widgetIds = appWidgetManager.getAppWidgetIds(componentName)

        widgetIds.forEach { appWidgetId ->
            val sharedPreferences = reactContext.getSharedPreferences("QuotifyWidget", Context.MODE_PRIVATE)
            sharedPreferences.edit()
                .putInt("widget_page_index_$appWidgetId", 0)
                .apply()

            val views = QuoteWidgetProvider.buildWidgetViews(reactContext, appWidgetId, quote, author)
            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
