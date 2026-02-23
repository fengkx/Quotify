import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
  StatusBar,
  TouchableOpacity,
  Text,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import QuoteCard from './QuoteCard';
import FavoritesScreen from './FavoritesScreen';
import CategoryFilter from './CategoryFilter';
import DataSourceSettings from './DataSourceSettings';
import WidgetService from '../services/WidgetService';
import QuoteService from '../services/QuoteService';

const QuoteGenerator = () => {
  const [quote, setQuote] = useState('');
  const [author, setAuthor] = useState('');
  const [quoteTags, setQuoteTags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [currentScreen, setCurrentScreen] = useState('main'); // 'main' or 'favorites'
  const [selectedTags, setSelectedTags] = useState([]);
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);
  const [showDataSourceSettings, setShowDataSourceSettings] = useState(false);
  const [datasetVersion, setDatasetVersion] = useState(0);
  const [sourceInfo, setSourceInfo] = useState(QuoteService.getSourceInfo());
  const hasHandledSelectedTagsEffect = useRef(false);
  const hasAppliedWidgetLaunchQuote = useRef(false);

  const applyWidgetOpenQuote = useCallback((widgetQuote) => {
    if (!widgetQuote?.content || !widgetQuote?.author) {
      return false;
    }

    setQuote(widgetQuote.content);
    setAuthor(widgetQuote.author);
    setQuoteTags([]);
    setLoading(false);
    return true;
  }, []);

  const reconcileSelectedTags = (candidateTags = selectedTags) => {
    const availableTags = new Set(QuoteService.getAllTags());
    const nextTags = (candidateTags || []).filter(tag => availableTags.has(tag));

    if (nextTags.length !== selectedTags.length) {
      setSelectedTags(nextTags);
    }

    return nextTags;
  };

  const fetchRandomQuote = useCallback(async (activeTags = []) => {
    setLoading(true);
    try {
      console.log('Fetching quote from active quote source...');
      
      // Get random quote from active source, filtered by selected tags if any
      let quoteData;
      if (activeTags.length > 0) {
        quoteData = QuoteService.getRandomQuoteByTags(activeTags);
        console.log('Quote data received (filtered):', quoteData);
      } else {
        quoteData = QuoteService.getRandomQuote();
        console.log('Quote data received (unfiltered):', quoteData);
      }
      
      if (quoteData && quoteData.content && quoteData.author) {
        setQuote(quoteData.content);
        setAuthor(quoteData.author);
        setQuoteTags(quoteData.tags || []);
        
        // Update widget with new quote
        await WidgetService.updateWidgetData();
      } else {
        throw new Error(activeTags.length > 0 
          ? 'No quotes found for the selected categories. Try selecting different categories or clear all filters.'
          : 'No valid quote data received from the current source'
        );
      }
    } catch (error) {
      console.error('Error loading quote:', error);
      
      Alert.alert(
        'Error',
        `Failed to load quote.\n\nError: ${error.message}`,
        [{ text: 'OK' }]
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const handleNewQuote = async () => {
    fetchRandomQuote(selectedTags);
  };

  const applySourceChange = async (action) => {
    await action();
    const nextSourceInfo = QuoteService.getSourceInfo();
    setSourceInfo(nextSourceInfo);
    setDatasetVersion(prev => prev + 1);

    const nextTags = reconcileSelectedTags(selectedTags);
    await fetchRandomQuote(nextTags);
  };

  const handleApplyEndpoint = async (endpoint) => {
    await applySourceChange(() => QuoteService.setCustomEndpoint(endpoint));
  };

  const handleRefreshSource = async () => {
    await applySourceChange(() => QuoteService.refreshCustomEndpoint());
  };

  const handleUseBuiltInSource = async () => {
    await applySourceChange(() => QuoteService.clearCustomEndpoint());
  };

  useEffect(() => {
    let unsubscribe;
    let mounted = true;

    const initialize = async () => {
      try {
        await QuoteService.initialize();
      } catch (error) {
        console.error('QuoteService initialization error:', error);
      } finally {
        if (!mounted) {
          return;
        }

        setSourceInfo(QuoteService.getSourceInfo());
        setDatasetVersion(prev => prev + 1);
        const widgetLaunchQuote = await WidgetService.getInitialWidgetOpenQuote();
        if (widgetLaunchQuote && applyWidgetOpenQuote(widgetLaunchQuote)) {
          hasAppliedWidgetLaunchQuote.current = true;
          return;
        }

        fetchRandomQuote([]);
      }
    };

    unsubscribe = QuoteService.subscribe(event => {
      if (!mounted) {
        return;
      }

      if (event?.sourceInfo) {
        setSourceInfo(event.sourceInfo);
      } else {
        setSourceInfo(QuoteService.getSourceInfo());
      }

      if (event?.type === 'datasetChanged') {
        setDatasetVersion(prev => prev + 1);
      }
    });

    initialize();

    const linkSubscription = Linking.addEventListener('url', async ({ url }) => {
      if (!WidgetService.isWidgetOpenUrl(url)) {
        return;
      }

      const widgetQuote = await WidgetService.getCurrentWidgetQuote();
      if (widgetQuote) {
        applyWidgetOpenQuote(widgetQuote);
      }
    });

    return () => {
      mounted = false;
      linkSubscription?.remove?.();
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [applyWidgetOpenQuote, fetchRandomQuote]);

  useEffect(() => {
    // Skip first render; initial quote load is handled by initialize().
    if (!hasHandledSelectedTagsEffect.current) {
      hasHandledSelectedTagsEffect.current = true;
      return;
    }

    fetchRandomQuote(selectedTags);
  }, [fetchRandomQuote, selectedTags]);

  return (
    <View style={[styles.container, currentScreen === 'favorites' && styles.favoritesContainer]}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      
      {currentScreen === 'favorites' ? (
        <FavoritesScreen onBack={() => setCurrentScreen('main')} />
      ) : (
        <>
          {/* Top Action Buttons */}
          <View style={styles.topButtonsContainer}>
            {/* Filter Button */}
            <TouchableOpacity
              style={[styles.actionButton, selectedTags.length > 0 && styles.actionButtonActive]}
              onPress={() => setShowCategoryFilter(true)}
              activeOpacity={0.8}
            >
              <Icon name="funnel" size={18} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>
                {selectedTags.length > 0 ? `Filter (${selectedTags.length})` : 'Filter'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionButton,
                sourceInfo.activeMode === 'custom' && styles.actionButtonCustomSource,
              ]}
              onPress={() => setShowDataSourceSettings(true)}
              activeOpacity={0.8}
            >
              <Icon name="server-outline" size={18} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>
                {sourceInfo.activeMode === 'custom' ? 'Source: API' : 'Source'}
              </Text>
            </TouchableOpacity>

            {/* Favorites Button */}
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => setCurrentScreen('favorites')}
              activeOpacity={0.8}
            >
              <Icon name="heart" size={18} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Favorites</Text>
            </TouchableOpacity>
          </View>

          {quote && author ? (
            <QuoteCard
              quote={quote}
              author={author}
              tags={quoteTags}
              onNewQuote={handleNewQuote}
              loading={loading}
              isOffline={false} // Always false since we're using local data
            />
          ) : (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#FFFFFF" />
              <Text style={styles.loadingText}>Loading inspiration...</Text>
            </View>
          )}

          {/* Category Filter Modal */}
          <CategoryFilter
            visible={showCategoryFilter}
            onClose={() => setShowCategoryFilter(false)}
            selectedTags={selectedTags}
            onTagsChange={setSelectedTags}
            datasetVersion={datasetVersion}
          />

          <DataSourceSettings
            visible={showDataSourceSettings}
            onClose={() => setShowDataSourceSettings(false)}
            sourceInfo={sourceInfo}
            onApplyEndpoint={handleApplyEndpoint}
            onRefresh={handleRefreshSource}
            onUseBuiltIn={handleUseBuiltInSource}
          />
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  favoritesContainer: {
    justifyContent: 'flex-start',
    alignItems: 'stretch',
  },
  topButtonsContainer: {
    position: 'absolute',
    top: Platform.OS === 'android' ? 60 : 60,
    right: 20,
    left: 20,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    zIndex: 1,
    gap: 12,
  },
  actionButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    flexDirection: 'row',
    alignItems: 'center',
    // Platform-specific shadows
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: {
          width: 0,
          height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  actionButtonActive: {
    backgroundColor: 'rgba(0, 122, 255, 0.8)',
    borderColor: 'rgba(0, 122, 255, 0.9)',
  },
  actionButtonCustomSource: {
    backgroundColor: 'rgba(16, 185, 129, 0.85)',
    borderColor: 'rgba(16, 185, 129, 0.95)',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 18,
    marginTop: 20,
    textAlign: 'center',
    opacity: 0.8,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});

export default QuoteGenerator; 
