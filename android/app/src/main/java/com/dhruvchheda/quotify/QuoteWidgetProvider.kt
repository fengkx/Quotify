package com.dhruvchheda.quotify

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.random.Random

class QuoteWidgetProvider : AppWidgetProvider() {

    companion object {
        data class WidgetTextBudget(
            val widthDp: Int,
            val authorLineCount: Int,
            val authorHeightPx: Int,
            val contentContainerHeightPx: Int,
            val quoteAvailableHeightPx: Int
        )

        const val ACTION_REFRESH_WIDGET = "com.dhruvchheda.quotify.REFRESH_WIDGET"
        const val ACTION_PREV_PAGE = "com.dhruvchheda.quotify.PREV_WIDGET_PAGE"
        const val ACTION_NEXT_PAGE = "com.dhruvchheda.quotify.NEXT_WIDGET_PAGE"
        const val WIDGET_QUOTE_KEY = "widget_quote"
        const val WIDGET_AUTHOR_KEY = "widget_author"
        const val WIDGET_LAST_UPDATE_KEY = "widget_last_update"
        const val WIDGET_SOURCE_MODE_KEY = "widget_source_mode"
        const val WIDGET_LAST_UPDATE_ISO_KEY = "widget_last_update_iso"
        const val WIDGET_DATASET_CACHE_KEY = "widget_dataset_cache"
        private const val WIDGET_PAGE_PREFIX = "widget_page_index_"
        private val widgetActionLock = Any()
        
        private val fallbackQuotes = arrayOf(
            Pair("The only way to do great work is to love what you do.", "Steve Jobs"),
            Pair("Innovation distinguishes between a leader and a follower.", "Steve Jobs"),
            Pair("Life is what happens to you while you're busy making other plans.", "John Lennon"),
            Pair("The future belongs to those who believe in the beauty of their dreams.", "Eleanor Roosevelt"),
            Pair("It is during our darkest moments that we must focus to see the light.", "Aristotle"),
            Pair("Success is not final, failure is not fatal: it is the courage to continue that counts.", "Winston Churchill")
        )

        fun applyWidgetIntents(context: Context, views: RemoteViews, appWidgetId: Int) {
            val refreshIntent = Intent(context, QuoteWidgetProvider::class.java).apply {
                action = ACTION_REFRESH_WIDGET
                data = Uri.parse("quotify://widget-action/refresh/$appWidgetId")
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            }
            val refreshPendingIntent = PendingIntent.getBroadcast(
                context,
                appWidgetId,
                refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_refresh_button, refreshPendingIntent)

            val prevPageIntent = Intent(context, QuoteWidgetProvider::class.java).apply {
                action = ACTION_PREV_PAGE
                data = Uri.parse("quotify://widget-action/prev/$appWidgetId")
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            }
            val prevPagePendingIntent = PendingIntent.getBroadcast(
                context,
                appWidgetId + 9_000,
                prevPageIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_prev_button, prevPagePendingIntent)

            val nextPageIntent = Intent(context, QuoteWidgetProvider::class.java).apply {
                action = ACTION_NEXT_PAGE
                data = Uri.parse("quotify://widget-action/page/$appWidgetId")
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            }
            val nextPagePendingIntent = PendingIntent.getBroadcast(
                context,
                appWidgetId + 10_000,
                nextPageIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_next_button, nextPagePendingIntent)

            val openAppIntent = Intent(Intent.ACTION_VIEW, Uri.parse("quotify://widget-open"), context, MainActivity::class.java)
            val openAppPendingIntent = PendingIntent.getActivity(
                context, appWidgetId + 20_000, openAppIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_quote_text, openAppPendingIntent)
        }

        private fun getPageIndexKey(appWidgetId: Int): String = "$WIDGET_PAGE_PREFIX$appWidgetId"

        private fun getStoredPageIndex(context: Context, appWidgetId: Int): Int {
            val sharedPreferences = context.getSharedPreferences("QuotifyWidget", Context.MODE_PRIVATE)
            return max(0, sharedPreferences.getInt(getPageIndexKey(appWidgetId), 0))
        }

        private fun setStoredPageIndex(context: Context, appWidgetId: Int, pageIndex: Int) {
            val sharedPreferences = context.getSharedPreferences("QuotifyWidget", Context.MODE_PRIVATE)
            sharedPreferences.edit().putInt(getPageIndexKey(appWidgetId), max(0, pageIndex)).apply()
        }

        private fun resetStoredPageIndex(context: Context, appWidgetId: Int) {
            setStoredPageIndex(context, appWidgetId, 0)
        }

        private fun computeQuoteMaxLines(context: Context, appWidgetId: Int): Int {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val options: Bundle = appWidgetManager.getAppWidgetOptions(appWidgetId)
            val (widthDp, heightDp) = estimateCurrentWidgetSizeDp(context, options)

            // Reserve space for paddings + author + button row, but keep it realistic.
            // Over-reserving causes too many pages and visible empty space.
            val reservedDp = 18 + 18 + 12 + 18 + 12 + 42 + 8
            val lineHeightDp = 24.0
            val byHeight = floor(((heightDp - reservedDp).coerceAtLeast(72)) / lineHeightDp).toInt()

            val charsPerLineEstimate = estimateCharsPerLineForQuote("", widthDp)
            val widthPenalty = if (charsPerLineEstimate < 14) 1 else 0

            return (byHeight - widthPenalty).coerceIn(4, 10)
        }

        private fun estimateCurrentWidgetSizeDp(context: Context, options: Bundle): Pair<Int, Int> {
            val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)
            val maxWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0)
            val minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
            val maxHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)

            val isPortrait = context.resources.configuration.orientation != android.content.res.Configuration.ORIENTATION_LANDSCAPE

            val width = when {
                isPortrait && minWidth > 0 -> minWidth
                !isPortrait && maxWidth > 0 -> maxWidth
                maxWidth > 0 && minWidth > 0 -> min((minWidth + maxWidth) / 2, maxWidth)
                minWidth > 0 -> minWidth
                maxWidth > 0 -> maxWidth
                else -> 250
            }

            val height = when {
                isPortrait && maxHeight > 0 -> maxHeight
                !isPortrait && minHeight > 0 -> minHeight
                maxHeight > 0 && minHeight > 0 -> max((minHeight + maxHeight) / 2, minHeight)
                maxHeight > 0 -> maxHeight
                minHeight > 0 -> minHeight
                else -> 250
            }

            return Pair(width, height)
        }

        private fun estimateCharsPerLineForQuote(quote: String, widthDp: Int): Int {
            val contentWidthDp = (widthDp - 36).coerceAtLeast(120)
            val sample = quote.take(240)
            val cjkCount = sample.count {
                Character.UnicodeScript.of(it.code) in setOf(
                    Character.UnicodeScript.HAN,
                    Character.UnicodeScript.HIRAGANA,
                    Character.UnicodeScript.KATAKANA,
                    Character.UnicodeScript.HANGUL
                )
            }
            val latinOrDigitCount = sample.count { it.isLetterOrDigit() && it.code < 0x2E80 }
            val totalWeighted = cjkCount + latinOrDigitCount + (sample.length - cjkCount - latinOrDigitCount)
            val cjkRatio = if (totalWeighted > 0) cjkCount.toDouble() / totalWeighted else 0.0

            // Chinese/Japanese/Korean glyphs are visually wider at 16sp in this widget than Latin text.
            // Use a larger divisor for CJK-heavy quotes to avoid optimistic capacity estimates.
            val divisor = 9.0 + (cjkRatio * 5.0) // ~9 for Latin, ~14 for CJK-heavy
            return (contentWidthDp / divisor).roundToInt().coerceIn(10, 28)
        }

        private fun buildTextLayout(
            text: String,
            textSizeSp: Float,
            widthDp: Int,
            lineSpacingExtraDp: Float,
            alignment: Layout.Alignment,
            context: Context
        ): StaticLayout {
            val displayMetrics = context.resources.displayMetrics
            val contentWidthDp = (widthDp - 36).coerceAtLeast(120)
            val textWidthPx = (contentWidthDp * displayMetrics.density).roundToInt().coerceAtLeast(1)
            val textSizePx = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, textSizeSp, displayMetrics)
            val lineSpacingExtraPx = lineSpacingExtraDp * displayMetrics.density

            val textPaint = TextPaint().apply {
                isAntiAlias = true
                textSize = textSizePx
            }

            return StaticLayout.Builder
                .obtain(text, 0, text.length, textPaint, textWidthPx)
                .setAlignment(alignment)
                .setIncludePad(false)
                .setLineSpacing(lineSpacingExtraPx, 1.0f)
                .build()
        }

        private fun dpToPx(context: Context, dp: Float): Int {
            return (dp * context.resources.displayMetrics.density).roundToInt()
        }

        private fun layoutHeightPx(layout: StaticLayout): Int {
            if (layout.lineCount <= 0) {
                return 0
            }
            return layout.getLineBottom(layout.lineCount - 1)
        }

        private fun computeAuthorLayout(context: Context, appWidgetId: Int, author: String): Pair<StaticLayout?, Int> {
            if (author.isBlank()) {
                return Pair(null, 1)
            }

            val appWidgetManager = AppWidgetManager.getInstance(context)
            val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
            val (widthDp, _) = estimateCurrentWidgetSizeDp(context, options)
            val authorText = "— $author"
            val authorLayout = buildTextLayout(
                text = authorText,
                textSizeSp = 14f,
                widthDp = widthDp,
                lineSpacingExtraDp = 0f,
                alignment = Layout.Alignment.ALIGN_CENTER,
                context = context,
            )
            return Pair(authorLayout, authorLayout.lineCount.coerceAtLeast(1))
        }

        private fun computeQuoteAvailableHeightPx(context: Context, appWidgetId: Int, author: String): WidgetTextBudget {
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
            val (widthDp, heightDp) = estimateCurrentWidgetSizeDp(context, options)
            val totalHeightPx = dpToPx(context, heightDp.toFloat())

            val (authorLayout, authorLineCount) = computeAuthorLayout(context, appWidgetId, author)
            val authorHeightPx = authorLayout?.let { layoutHeightPx(it) } ?: 0

            val verticalReservedPx =
                dpToPx(context, 18f) + // top padding
                dpToPx(context, 18f) + // bottom padding
                dpToPx(context, 14f) + // quote -> author margin
                dpToPx(context, 14f) + // author -> button margin
                dpToPx(context, 4f) +  // button row top margin
                dpToPx(context, 40f) + // button row min height
                dpToPx(context, 4f)    // safety buffer

            val availableQuoteHeightPx = (totalHeightPx - verticalReservedPx - authorHeightPx)
                .coerceAtLeast(dpToPx(context, 22f))

            val contentContainerHeightPx = (totalHeightPx -
                dpToPx(context, 18f) - // top padding
                dpToPx(context, 18f) - // bottom padding
                dpToPx(context, 4f) -  // button row top margin
                dpToPx(context, 40f)   // button row height
            ).coerceAtLeast(dpToPx(context, 48f))

            return WidgetTextBudget(
                widthDp = widthDp,
                authorLineCount = authorLineCount,
                authorHeightPx = authorHeightPx,
                contentContainerHeightPx = contentContainerHeightPx,
                quoteAvailableHeightPx = availableQuoteHeightPx,
            )
        }

        private fun computeAuthorLineBudget(context: Context, appWidgetId: Int, author: String, totalTextLines: Int): Int {
            if (author.isBlank()) {
                return 1
            }

            val appWidgetManager = AppWidgetManager.getInstance(context)
            val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
            val (widthDp, _) = estimateCurrentWidgetSizeDp(context, options)
            val authorText = "— $author"
            val authorLayout = buildTextLayout(
                text = authorText,
                textSizeSp = 14f,
                widthDp = widthDp,
                lineSpacingExtraDp = 0f,
                alignment = Layout.Alignment.ALIGN_CENTER,
                context = context,
            )

            val measured = authorLayout.lineCount.coerceAtLeast(1)
            // Prioritize showing the author completely. Keep at least one quote line visible.
            val maxAllowed = (totalTextLines - 1).coerceAtLeast(1)
            return measured.coerceAtMost(maxAllowed)
        }

        private fun paginateQuoteForWidget(
            quote: String,
            availableQuoteHeightPx: Int,
            appWidgetId: Int,
            context: Context
        ): Pair<String, Int> {
            if (quote.isBlank()) {
                setStoredPageIndex(context, appWidgetId, 0)
                return Pair(quote, 1)
            }

            val appWidgetManager = AppWidgetManager.getInstance(context)
            val options = appWidgetManager.getAppWidgetOptions(appWidgetId)
            val (widthDp, _) = estimateCurrentWidgetSizeDp(context, options)

            val chunks = mutableListOf<String>()
            var cursor = 0
            while (cursor < quote.length) {
                val remaining = quote.substring(cursor)
                val layout = buildTextLayout(
                    text = remaining,
                    textSizeSp = 16f,
                    widthDp = widthDp,
                    lineSpacingExtraDp = 5f,
                    alignment = Layout.Alignment.ALIGN_NORMAL,
                    context = context,
                )

                if (layout.lineCount == 0 || layoutHeightPx(layout) <= availableQuoteHeightPx) {
                    chunks.add(remaining)
                    break
                }

                var lastVisibleLine = -1
                for (line in 0 until layout.lineCount) {
                    if (layout.getLineBottom(line) <= availableQuoteHeightPx) {
                        lastVisibleLine = line
                    } else {
                        break
                    }
                }
                if (lastVisibleLine < 0) {
                    lastVisibleLine = 0
                }

                val hardEnd = layout.getLineEnd(lastVisibleLine)
                val softStart = max(0, hardEnd - max(12, hardEnd / 4))
                var splitAt = hardEnd
                for (i in hardEnd - 1 downTo softStart) {
                    val ch = remaining[i]
                    if (
                        ch == '\n' || ch == ' ' || ch == '\t' ||
                        ch == '。' || ch == '，' || ch == '、' || ch == '；' || ch == '：' ||
                        ch == '！' || ch == '？' || ch == '.' || ch == ',' || ch == ';' || ch == ':' ||
                        ch == ')' || ch == '）' || ch == '」' || ch == '』' || ch == '”'
                    ) {
                        splitAt = i + 1
                        break
                    }
                }

                if (splitAt <= 0) {
                    splitAt = hardEnd.coerceAtLeast(1)
                }

                chunks.add(remaining.substring(0, splitAt).trimEnd())
                cursor += splitAt
                while (cursor < quote.length && (quote[cursor] == ' ' || quote[cursor] == '\n' || quote[cursor] == '\t')) {
                    cursor += 1
                }
            }

            if (chunks.isEmpty()) {
                setStoredPageIndex(context, appWidgetId, 0)
                return Pair(quote, 1)
            }

            val currentPage = getStoredPageIndex(context, appWidgetId).coerceIn(0, chunks.lastIndex)
            if (currentPage != getStoredPageIndex(context, appWidgetId)) {
                setStoredPageIndex(context, appWidgetId, currentPage)
            }
            return Pair(chunks[currentPage], chunks.size)
        }

        fun buildWidgetViews(context: Context, appWidgetId: Int, quote: String, author: String): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.quote_widget)
            val budget = computeQuoteAvailableHeightPx(context, appWidgetId, author)
            var quoteAvailableHeightPx = budget.quoteAvailableHeightPx
            var pagination = paginateQuoteForWidget(quote, quoteAvailableHeightPx, appWidgetId, context)
            var pagedQuote = pagination.first
            var pageCount = pagination.second
            var pagedQuoteLayout = buildTextLayout(
                text = pagedQuote,
                textSizeSp = 16f,
                widthDp = budget.widthDp,
                lineSpacingExtraDp = 5f,
                alignment = Layout.Alignment.ALIGN_NORMAL,
                context = context,
            )
            val quoteToAuthorMarginPx = dpToPx(context, 14f)

            // Defensive fit loop: if our budget was optimistic, shrink quote budget and repaginate
            // until both the quote page and author fit in the content container.
            var guard = 0
            while (guard < 6) {
                val combinedContentHeightPx = layoutHeightPx(pagedQuoteLayout) + quoteToAuthorMarginPx + budget.authorHeightPx
                val overflowPx = combinedContentHeightPx - budget.contentContainerHeightPx
                if (overflowPx <= 0) {
                    break
                }

                quoteAvailableHeightPx = (quoteAvailableHeightPx - overflowPx - dpToPx(context, 4f))
                    .coerceAtLeast(dpToPx(context, 18f))
                pagination = paginateQuoteForWidget(quote, quoteAvailableHeightPx, appWidgetId, context)
                pagedQuote = pagination.first
                pageCount = pagination.second
                pagedQuoteLayout = buildTextLayout(
                    text = pagedQuote,
                    textSizeSp = 16f,
                    widthDp = budget.widthDp,
                    lineSpacingExtraDp = 5f,
                    alignment = Layout.Alignment.ALIGN_NORMAL,
                    context = context,
                )
                guard += 1
            }

            val currentPage = getStoredPageIndex(context, appWidgetId)
            val quoteMaxLines = pagedQuoteLayout.lineCount.coerceAtLeast(1)

            views.setInt(R.id.widget_quote_text, "setMaxLines", quoteMaxLines)
            views.setTextViewText(R.id.widget_quote_text, pagedQuote)
            views.setInt(R.id.widget_author_text, "setMaxLines", budget.authorLineCount.coerceAtLeast(1))
            views.setTextViewText(R.id.widget_author_text, "— $author")
            views.setViewVisibility(R.id.widget_author_text, View.VISIBLE)

            if (pageCount > 1) {
                views.setInt(R.id.widget_content_container, "setGravity", Gravity.TOP)
                views.setViewVisibility(R.id.widget_prev_button, View.VISIBLE)
                views.setViewVisibility(R.id.widget_page_label, View.VISIBLE)
                views.setViewVisibility(R.id.widget_next_button, View.VISIBLE)
                views.setTextViewText(R.id.widget_page_label, "${currentPage + 1}/$pageCount")
            } else {
                views.setInt(R.id.widget_content_container, "setGravity", Gravity.CENTER_VERTICAL)
                views.setViewVisibility(R.id.widget_prev_button, View.GONE)
                views.setViewVisibility(R.id.widget_page_label, View.GONE)
                views.setViewVisibility(R.id.widget_next_button, View.GONE)
            }

            applyWidgetIntents(context, views, appWidgetId)
            return views
        }
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle
    ) {
        super.onAppWidgetOptionsChanged(context, appWidgetManager, appWidgetId, newOptions)
        updateAppWidget(context, appWidgetManager, appWidgetId)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        
        Log.d(
            "QuoteWidget",
            "onReceive action=${intent.action} widgetId=${intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)} data=${intent.data}"
        )
        
        if (ACTION_PREV_PAGE == intent.action || ACTION_NEXT_PAGE == intent.action) {
            val appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            if (appWidgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
                synchronized(widgetActionLock) {
                    val step = if (ACTION_PREV_PAGE == intent.action) -1 else 1
                    shiftPageAndUpdate(context, AppWidgetManager.getInstance(context), appWidgetId, step)
                }
            }
            return
        }

        if (ACTION_REFRESH_WIDGET == intent.action) {
            Log.d("QuoteWidget", "Refresh widget action received")
            val appWidgetManager = AppWidgetManager.getInstance(context)
            val requestedWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            val targetWidgetIds = if (requestedWidgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
                intArrayOf(requestedWidgetId)
            } else {
                val componentName = ComponentName(context, QuoteWidgetProvider::class.java)
                appWidgetManager.getAppWidgetIds(componentName)
            }

            Log.d("QuoteWidget", "Refreshing ${targetWidgetIds.size} widget(s): ${targetWidgetIds.joinToString()}")

            for (appWidgetId in targetWidgetIds) {
                Thread {
                    synchronized(widgetActionLock) {
                        if (getStoredSourceMode(context) == "custom") {
                            Log.d("QuoteWidget", "Custom source active; refreshing from cached custom dataset for widget $appWidgetId")
                            fetchAndUpdateQuoteFromCustomCache(context, appWidgetManager, appWidgetId)
                        } else {
                            fetchAndUpdateQuote(context, appWidgetManager, appWidgetId)
                        }
                    }
                }.start()
            }
        }
    }

    private fun updateAppWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        Log.d("QuoteWidget", "Updating widget $appWidgetId")
        // Load and display quote
        val quoteData = getStoredQuote(context)
        val views = buildWidgetViews(context, appWidgetId, quoteData.first, quoteData.second)
        
        appWidgetManager.updateAppWidget(appWidgetId, views)
        
        // If no quote is stored, fetch a new one
        if (quoteData.first == "Loading inspiration...") {
            Thread {
                fetchAndUpdateQuote(context, appWidgetManager, appWidgetId)
            }.start()
        }
    }

    private fun fetchAndUpdateQuote(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        Log.d("QuoteWidget", "Fetching new quote for widget $appWidgetId")
        val quoteData = fetchQuoteFromLocalFile(context)
        
        Log.d("QuoteWidget", "Got quote: ${quoteData.first} by ${quoteData.second}")
        
        // Store the quote
        storeQuote(context, quoteData.first, quoteData.second)
        resetStoredPageIndex(context, appWidgetId)
        
        val views = buildWidgetViews(context, appWidgetId, quoteData.first, quoteData.second)
        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun fetchAndUpdateQuoteFromCustomCache(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        Log.d("QuoteWidget", "Fetching quote from cached custom dataset for widget $appWidgetId")
        val quoteData = fetchQuoteFromCustomCache(context)

        storeQuote(context, quoteData.first, quoteData.second)
        resetStoredPageIndex(context, appWidgetId)

        val views = buildWidgetViews(context, appWidgetId, quoteData.first, quoteData.second)
        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun shiftPageAndUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, step: Int) {
        val quoteData = getStoredQuote(context)
        val budget = computeQuoteAvailableHeightPx(context, appWidgetId, quoteData.second)
        val quoteFingerprintBefore = "${quoteData.first.hashCode()}:${quoteData.second.hashCode()}"
        val (_, pageCount) = paginateQuoteForWidget(quoteData.first, budget.quoteAvailableHeightPx, appWidgetId, context)

        if (pageCount <= 1) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
            return
        }

        val currentPage = getStoredPageIndex(context, appWidgetId)
        val nextPage = ((currentPage + step) % pageCount + pageCount) % pageCount
        Log.d(
            "QuoteWidget",
            "PAGE_SHIFT widget=$appWidgetId step=$step page $currentPage->$nextPage / $pageCount quote=$quoteFingerprintBefore"
        )
        setStoredPageIndex(context, appWidgetId, nextPage)

        val views = buildWidgetViews(context, appWidgetId, quoteData.first, quoteData.second)
        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun fetchQuoteFromLocalFile(context: Context): Pair<String, String> {
        return try {
            Log.d("QuoteWidget", "Loading quote from local JSON file")
            
            val inputStream = context.assets.open("quotes.json")
            val size = inputStream.available()
            val buffer = ByteArray(size)
            inputStream.read(buffer)
            inputStream.close()
            
            val jsonString = String(buffer, Charsets.UTF_8)
            val jsonObject = JSONObject(jsonString)
            val quotesArray = jsonObject.getJSONArray("quotes")
            
            if (quotesArray.length() > 0) {
                val randomIndex = Random.nextInt(quotesArray.length())
                val selectedQuote = quotesArray.getJSONObject(randomIndex)
                
                val content = selectedQuote.getString("content")
                val author = selectedQuote.getString("author")
                
                if (content.isNotEmpty() && author.isNotEmpty()) {
                    Log.d("QuoteWidget", "Successfully loaded quote from local file: $content by $author")
                    return Pair(content, author)
                }
            }
            
            Log.w("QuoteWidget", "Failed to load valid quote from local file, using fallback")
            getRandomFallbackQuote()
        } catch (e: Exception) {
            Log.e("QuoteWidget", "Error loading quote from local file: ${e.message}", e)
            getRandomFallbackQuote()
        }
    }

    private fun getRandomFallbackQuote(): Pair<String, String> {
        val randomIndex = Random.nextInt(fallbackQuotes.size)
        return fallbackQuotes[randomIndex]
    }

    private fun fetchQuoteFromCustomCache(context: Context): Pair<String, String> {
        val sharedPreferences = context.getSharedPreferences("QuotifyWidget", Context.MODE_PRIVATE)
        val datasetJson = sharedPreferences.getString(WIDGET_DATASET_CACHE_KEY, null)

        if (datasetJson.isNullOrBlank()) {
            Log.w("QuoteWidget", "No cached custom dataset found, using currently stored quote")
            return getStoredQuote(context)
        }

        return try {
            val root = JSONObject(datasetJson)
            val quotesArray = root.optJSONArray("quotes")
            if (quotesArray == null || quotesArray.length() == 0) {
                Log.w("QuoteWidget", "Cached custom dataset is empty, using currently stored quote")
                return getStoredQuote(context)
            }

            val selectedQuote = quotesArray.getJSONObject(Random.nextInt(quotesArray.length()))
            val content = selectedQuote.optString("content", "").trim()
            val author = selectedQuote.optString("author", "").trim()

            if (content.isNotEmpty() && author.isNotEmpty()) {
                Pair(content, author)
            } else {
                Log.w("QuoteWidget", "Cached custom dataset quote invalid, using currently stored quote")
                getStoredQuote(context)
            }
        } catch (e: Exception) {
            Log.e("QuoteWidget", "Failed to parse cached custom dataset: ${e.message}", e)
            getStoredQuote(context)
        }
    }

    private fun storeQuote(context: Context, quote: String, author: String) {
        val sharedPreferences = context.getSharedPreferences("QuotifyWidget", Context.MODE_PRIVATE)
        val editor = sharedPreferences.edit()
        editor.putString(WIDGET_QUOTE_KEY, quote)
        editor.putString(WIDGET_AUTHOR_KEY, author)
        editor.putLong(WIDGET_LAST_UPDATE_KEY, System.currentTimeMillis())
        editor.apply()
    }

    private fun getStoredQuote(context: Context): Pair<String, String> {
        val sharedPreferences = context.getSharedPreferences("QuotifyWidget", Context.MODE_PRIVATE)
        val quote = sharedPreferences.getString(WIDGET_QUOTE_KEY, "Loading inspiration...")
        val author = sharedPreferences.getString(WIDGET_AUTHOR_KEY, "Quotify")
        return Pair(quote ?: "Loading inspiration...", author ?: "Quotify")
    }

    private fun getStoredSourceMode(context: Context): String {
        val sharedPreferences = context.getSharedPreferences("QuotifyWidget", Context.MODE_PRIVATE)
        return sharedPreferences.getString(WIDGET_SOURCE_MODE_KEY, "local") ?: "local"
    }

    fun refreshWidget(context: Context) {
        val intent = Intent(context, QuoteWidgetProvider::class.java)
        // ... existing code ...
    }
} 
