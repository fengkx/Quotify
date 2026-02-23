import AsyncStorage from '@react-native-async-storage/async-storage';
import quotesData from '../quotes.json';
import { validateAndNormalizeQuotePayload } from './QuoteSourceValidator';

const STORAGE_KEYS = {
  SOURCE_MODE: 'quotes_source_mode',
  CUSTOM_ENDPOINT: 'quotes_custom_endpoint',
  CUSTOM_CACHE: 'quotes_custom_dataset_cache',
};

const REQUEST_TIMEOUT_MS = 8000;
const CACHE_VERSION = 1;

const LOCAL_VALIDATION = validateAndNormalizeQuotePayload(quotesData);
const LOCAL_DATASET = LOCAL_VALIDATION.ok
  ? LOCAL_VALIDATION.data
  : { quotes: [], metadata: {} };

class QuoteService {
  static listeners = new Set();
  static initPromise = null;
  static initialized = false;

  static quotes = LOCAL_DATASET.quotes;
  static totalQuotes = LOCAL_DATASET.quotes.length;
  static metadata = LOCAL_DATASET.metadata;

  static activeSourceMode = 'local'; // actual dataset in use
  static configuredSourceMode = 'local'; // user preference
  static customEndpoint = null;
  static sourceStatus = 'idle';
  static usingCache = false;
  static lastUpdatedAt = LOCAL_DATASET.metadata?.fetch_date || null;
  static lastRefreshAttemptAt = null;
  static lastError = null;

  static subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  static emit(event) {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('QuoteService listener error:', error);
      }
    });
  }

  static setState(patch, emit = true) {
    Object.assign(this, patch);
    if (emit) {
      this.emit({
        type: 'sourceInfoChanged',
        sourceInfo: this.getSourceInfo(),
      });
    }
  }

  static setDataset({ quotes, metadata, activeSourceMode, usingCache = false, lastUpdatedAt = null }, reason = 'datasetChanged') {
    this.quotes = quotes;
    this.totalQuotes = quotes.length;
    this.metadata = metadata || {};
    this.activeSourceMode = activeSourceMode;
    this.usingCache = usingCache;
    this.lastUpdatedAt = lastUpdatedAt;

    this.emit({
      type: reason,
      sourceInfo: this.getSourceInfo(),
    });
  }

  static getSourceInfo() {
    return {
      activeMode: this.activeSourceMode,
      configuredMode: this.configuredSourceMode,
      endpoint: this.customEndpoint,
      status: this.sourceStatus,
      usingCache: this.usingCache,
      lastUpdatedAt: this.lastUpdatedAt,
      lastRefreshAttemptAt: this.lastRefreshAttemptAt,
      datasetCount: this.totalQuotes,
      metadata: this.metadata || null,
      error: this.lastError,
    };
  }

  static async initialize() {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.initializeInternal()
      .catch(error => {
        console.error('QuoteService initialize failed:', error);
        this.setState({
          sourceStatus: 'error',
          lastError: {
            code: 'INITIALIZE_FAILED',
            message: error?.message || 'Failed to initialize quote source.',
          },
        });
      })
      .finally(() => {
        this.initialized = true;
      });

    return this.initPromise;
  }

  static async initializeInternal() {
    const [storedMode, storedEndpoint] = await AsyncStorage.multiGet([
      STORAGE_KEYS.SOURCE_MODE,
      STORAGE_KEYS.CUSTOM_ENDPOINT,
    ]);

    const mode = storedMode?.[1];
    const endpoint = storedEndpoint?.[1];

    if (mode === 'custom' && endpoint) {
      this.configuredSourceMode = 'custom';
      this.customEndpoint = endpoint;

      const cacheLoaded = await this.loadCustomCache(endpoint);

      if (cacheLoaded) {
        this.setState({
          sourceStatus: 'ready',
          lastError: null,
        });

        // Refresh in background, but keep current cache if it fails.
        this.refreshCustomEndpoint({ background: true }).catch(error => {
          console.error('Background refresh failed:', error);
        });
        return;
      }

      this.setState({
        sourceStatus: 'loading',
        lastError: null,
      });

      await this.refreshCustomEndpoint({ background: false });
      return;
    }

    this.configuredSourceMode = 'local';
    this.customEndpoint = null;
    this.setDataset(
      {
        quotes: LOCAL_DATASET.quotes,
        metadata: LOCAL_DATASET.metadata,
        activeSourceMode: 'local',
        usingCache: false,
        lastUpdatedAt: LOCAL_DATASET.metadata?.fetch_date || null,
      },
      'datasetChanged',
    );
    this.setState({
      sourceStatus: 'ready',
      lastError: null,
    });
  }

  static isValidHttpsUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  static async setCustomEndpoint(url) {
    const normalizedUrl = typeof url === 'string' ? url.trim() : '';

    if (!this.isValidHttpsUrl(normalizedUrl)) {
      const error = {
        code: 'INVALID_URL',
        message: 'Custom endpoint must be a valid HTTPS URL.',
      };
      this.setState({
        sourceStatus: 'error',
        lastError: error,
      });
      throw new Error(error.message);
    }

    this.configuredSourceMode = 'custom';
    this.customEndpoint = normalizedUrl;
    await AsyncStorage.multiSet([
      [STORAGE_KEYS.SOURCE_MODE, 'custom'],
      [STORAGE_KEYS.CUSTOM_ENDPOINT, normalizedUrl],
    ]);

    this.setState({
      sourceStatus: 'loading',
      lastError: null,
    });

    return this.refreshCustomEndpoint({ background: false });
  }

  static async refreshCustomEndpoint({ background = false } = {}) {
    if (!this.customEndpoint) {
      const error = {
        code: 'NO_ENDPOINT',
        message: 'No custom endpoint configured.',
      };
      this.setState({
        sourceStatus: 'error',
        lastError: error,
      });
      throw new Error(error.message);
    }

    this.setState({
      sourceStatus: background ? 'refreshing' : 'loading',
      lastRefreshAttemptAt: new Date().toISOString(),
      lastError: null,
    });

    try {
      const payload = await this.fetchJson(this.customEndpoint);
      const validation = validateAndNormalizeQuotePayload(payload);

      if (!validation.ok) {
        const error = {
          code: validation.error.code,
          message: validation.error.message,
          details: validation.stats || null,
        };
        this.handleRefreshFailure(error, background);
        const handledError = new Error(error.message);
        handledError._handledByQuoteService = true;
        throw handledError;
      }

      const now = new Date().toISOString();
      await this.saveCustomCache(this.customEndpoint, validation.data, now);

      this.setDataset(
        {
          quotes: validation.data.quotes,
          metadata: validation.data.metadata,
          activeSourceMode: 'custom',
          usingCache: false,
          lastUpdatedAt: now,
        },
        'datasetChanged',
      );

      this.setState({
        sourceStatus: 'ready',
        lastError: null,
      });

      return this.getSourceInfo();
    } catch (error) {
      if (error && error._handledByQuoteService) {
        throw error;
      }

      const classified = this.classifyRequestError(error);
      this.handleRefreshFailure(classified, background);
      throw new Error(classified.message);
    }
  }

  static handleRefreshFailure(error, background) {
    const wrapped = {
      ...error,
      message: error.message || 'Failed to refresh custom quote source.',
    };

    this.setState({
      sourceStatus: 'error',
      lastError: wrapped,
    });

    if (!background) {
      // Keep current dataset as-is (local or previous custom cache/live data).
      this.emit({
        type: 'sourceRefreshFailed',
        sourceInfo: this.getSourceInfo(),
      });
    }
  }

  static async clearCustomEndpoint() {
    this.configuredSourceMode = 'local';
    this.customEndpoint = null;

    await AsyncStorage.multiSet([
      [STORAGE_KEYS.SOURCE_MODE, 'local'],
      [STORAGE_KEYS.CUSTOM_ENDPOINT, ''],
    ]);

    this.setDataset(
      {
        quotes: LOCAL_DATASET.quotes,
        metadata: LOCAL_DATASET.metadata,
        activeSourceMode: 'local',
        usingCache: false,
        lastUpdatedAt: LOCAL_DATASET.metadata?.fetch_date || null,
      },
      'datasetChanged',
    );

    this.setState({
      sourceStatus: 'ready',
      lastError: null,
    });

    return this.getSourceInfo();
  }

  static async loadCustomCache(expectedEndpoint) {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEYS.CUSTOM_CACHE);
      if (!raw) {
        return false;
      }

      const cached = JSON.parse(raw);
      if (!cached || cached.version !== CACHE_VERSION || cached.endpoint !== expectedEndpoint) {
        return false;
      }

      const validation = validateAndNormalizeQuotePayload(cached.payload);
      if (!validation.ok) {
        return false;
      }

      this.setDataset(
        {
          quotes: validation.data.quotes,
          metadata: validation.data.metadata,
          activeSourceMode: 'custom',
          usingCache: true,
          lastUpdatedAt: cached.cachedAt || null,
        },
        'datasetChanged',
      );

      return true;
    } catch (error) {
      console.error('Failed to load custom cache:', error);
      return false;
    }
  }

  static async saveCustomCache(endpoint, normalizedData, cachedAt) {
    const payload = {
      version: CACHE_VERSION,
      endpoint,
      cachedAt,
      payload: normalizedData,
    };

    await AsyncStorage.setItem(STORAGE_KEYS.CUSTOM_CACHE, JSON.stringify(payload));
  }

  static async fetchJson(url) {
    let timeoutId;
    let controller;

    try {
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
      }

      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          if (controller) {
            controller.abort();
          }
          reject(new Error('Request timed out.'));
        }, REQUEST_TIMEOUT_MS);
      });

      const response = await Promise.race([
        fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          signal: controller?.signal,
        }),
        timeoutPromise,
      ]);

      if (!response || !response.ok) {
        const status = response ? `${response.status}` : 'unknown';
        throw new Error(`Request failed with status ${status}.`);
      }

      try {
        return await response.json();
      } catch (error) {
        const parseError = new Error('Response is not valid JSON.');
        parseError.code = 'INVALID_JSON';
        throw parseError;
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  static classifyRequestError(error) {
    if (error?.code === 'INVALID_JSON') {
      return {
        code: 'INVALID_JSON',
        message: 'The endpoint returned invalid JSON.',
      };
    }

    if (error?.name === 'AbortError' || /timed out/i.test(error?.message || '')) {
      return {
        code: 'TIMEOUT',
        message: 'The request timed out while loading the custom source.',
      };
    }

    if (/Network request failed/i.test(error?.message || '')) {
      return {
        code: 'NETWORK_ERROR',
        message: 'Unable to connect to the custom endpoint.',
      };
    }

    return {
      code: 'NETWORK_ERROR',
      message: error?.message || 'Failed to load the custom endpoint.',
    };
  }

  static normalizeQuoteForUI(selectedQuote) {
    if (!selectedQuote) {
      return null;
    }

    return {
      content: selectedQuote.content,
      author: selectedQuote.author,
      tags: selectedQuote.tags || [],
      id: selectedQuote._id,
    };
  }

  static getRandomQuote() {
    if (this.totalQuotes === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * this.totalQuotes);
    const selectedQuote = this.quotes[randomIndex];
    return this.normalizeQuoteForUI(selectedQuote);
  }

  static getRandomQuoteByTag(tag) {
    const filteredQuotes = this.quotes.filter(q =>
      q.tags && q.tags.some(t => t.toLowerCase() === tag.toLowerCase())
    );

    if (filteredQuotes.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * filteredQuotes.length);
    return this.normalizeQuoteForUI(filteredQuotes[randomIndex]);
  }

  static getRandomQuoteByTags(tags) {
    if (!tags || tags.length === 0) {
      return this.getRandomQuote();
    }

    const filteredQuotes = this.quotes.filter(q =>
      q.tags && tags.some(tag =>
        q.tags.some(t => t.toLowerCase() === tag.toLowerCase())
      )
    );

    if (filteredQuotes.length === 0) {
      return null;
    }

    const randomIndex = Math.floor(Math.random() * filteredQuotes.length);
    return this.normalizeQuoteForUI(filteredQuotes[randomIndex]);
  }

  static getAllTags() {
    const tagSet = new Set();
    this.quotes.forEach(quote => {
      if (quote.tags) {
        quote.tags.forEach(tag => tagSet.add(tag));
      }
    });
    return Array.from(tagSet).sort();
  }

  static getTagsWithCount() {
    const tagCount = {};
    this.quotes.forEach(quote => {
      if (quote.tags) {
        quote.tags.forEach(tag => {
          tagCount[tag] = (tagCount[tag] || 0) + 1;
        });
      }
    });

    return Object.entries(tagCount)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  static getQuoteById(id) {
    const quote = this.quotes.find(q => q._id === id);
    return this.normalizeQuoteForUI(quote);
  }

  static getQuotesByAuthor(author) {
    return this.quotes
      .filter(q => q.author.toLowerCase().includes(author.toLowerCase()))
      .map(q => this.normalizeQuoteForUI(q));
  }

  static getQuotesByTag(tag) {
    return this.quotes
      .filter(q => q.tags && q.tags.some(t => t.toLowerCase().includes(tag.toLowerCase())))
      .map(q => this.normalizeQuoteForUI(q));
  }

  static searchQuotes(searchTerm) {
    const term = searchTerm.toLowerCase();
    return this.quotes
      .filter(q =>
        q.content.toLowerCase().includes(term) ||
        q.author.toLowerCase().includes(term) ||
        (q.tags && q.tags.some(t => t.toLowerCase().includes(term)))
      )
      .map(q => this.normalizeQuoteForUI(q));
  }

  static getTotalQuoteCount() {
    return this.totalQuotes;
  }

  static getMetadata() {
    return this.metadata;
  }

  static getWidgetQuoteDataset(maxCount = 500) {
    if (!Array.isArray(this.quotes) || this.quotes.length === 0) {
      return [];
    }

    const limitedQuotes = this.quotes.slice(0, maxCount);
    return limitedQuotes
      .map(quote => ({
        content: quote?.content,
        author: quote?.author,
      }))
      .filter(
        quote =>
          typeof quote.content === 'string' &&
          quote.content.trim() &&
          typeof quote.author === 'string' &&
          quote.author.trim(),
      );
  }
}

export default QuoteService;
