import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, NativeModules, Platform } from 'react-native';
import QuoteService from './QuoteService';

class WidgetService {
  static APP_GROUP_ID = 'group.com.dhruvchheda.quotify.widgets';
  static WIDGET_QUOTE_KEY = 'widget_quote';
  static WIDGET_AUTHOR_KEY = 'widget_author';
  static WIDGET_LAST_UPDATE_KEY = 'widget_last_update';
  static WIDGET_SOURCE_MODE_KEY = 'widget_source_mode';
  static WIDGET_SOURCE_INFO_KEY = 'widget_source_info';

  static getRandomQuote() {
    return QuoteService.getRandomQuote();
  }

  static async updateWidgetData() {
    try {
      const quoteData = this.getRandomQuote();
      if (!quoteData || !quoteData.content || !quoteData.author) {
        throw new Error('No quote available for widget update.');
      }

      const timestamp = new Date().toISOString();
      const sourceInfo = QuoteService.getSourceInfo();
      const sourceMode = sourceInfo?.activeMode || 'local';
      const widgetDataset = sourceMode === 'custom'
        ? QuoteService.getWidgetQuoteDataset()
        : [];
      const widgetDatasetJson = JSON.stringify({
        quotes: widgetDataset,
        sourceMode,
        syncedAt: timestamp,
      });
      
      // Use AsyncStorage for both platforms
      // iOS widgets will use App Groups to access this data
      // Android widgets now also receive a native sync to SharedPreferences
      await AsyncStorage.setItem(this.WIDGET_QUOTE_KEY, quoteData.content);
      await AsyncStorage.setItem(this.WIDGET_AUTHOR_KEY, quoteData.author);
      await AsyncStorage.setItem(this.WIDGET_LAST_UPDATE_KEY, timestamp);
      await AsyncStorage.setItem(this.WIDGET_SOURCE_MODE_KEY, sourceMode);
      await AsyncStorage.setItem(this.WIDGET_SOURCE_INFO_KEY, JSON.stringify({
        mode: sourceMode,
        lastUpdatedAt: timestamp,
      }));

      if (Platform.OS === 'android' && NativeModules.WidgetSync?.updateWidgetQuote) {
        await NativeModules.WidgetSync.updateWidgetQuote(
          quoteData.content,
          quoteData.author,
          sourceMode,
          timestamp,
          widgetDatasetJson,
        );
      }
      
      console.log('Widget data updated:', { ...quoteData, sourceMode });
      return quoteData;
    } catch (error) {
      console.error('Failed to update widget data:', error);
      return null;
    }
  }

  static async getWidgetData() {
    try {
      const quote = await AsyncStorage.getItem(this.WIDGET_QUOTE_KEY);
      const author = await AsyncStorage.getItem(this.WIDGET_AUTHOR_KEY);
      const lastUpdate = await AsyncStorage.getItem(this.WIDGET_LAST_UPDATE_KEY);
      const sourceMode = await AsyncStorage.getItem(this.WIDGET_SOURCE_MODE_KEY);
      
      if (quote && author) {
        return {
          content: quote,
          author: author,
          lastUpdate: lastUpdate,
          sourceMode: sourceMode || 'local',
        };
      } else {
        // If no data exists, create initial data
        return await this.updateWidgetData();
      }
    } catch (error) {
      console.error('Failed to get widget data:', error);
      return this.getRandomQuote();
    }
  }

  static async refreshWidget() {
    try {
      const updatedData = await this.updateWidgetData();
      
      // Trigger widget refresh on both platforms
      if (Platform.OS === 'ios') {
        // iOS widgets will be updated through WidgetKit timeline
        console.log('iOS widget data updated');
      } else {
        // Android widget update will be handled by the native widget provider
        console.log('Android widget data updated');
      }
      
      return updatedData;
    } catch (error) {
      console.error('Failed to refresh widget:', error);
      return null;
    }
  }

  static async getCurrentWidgetQuote() {
    if (Platform.OS !== 'android' || !NativeModules.WidgetSync?.getCurrentWidgetQuote) {
      return null;
    }

    try {
      return await NativeModules.WidgetSync.getCurrentWidgetQuote();
    } catch (error) {
      console.error('Failed to read current widget quote:', error);
      return null;
    }
  }

  static isWidgetOpenUrl(url) {
    return typeof url === 'string' && url.startsWith('quotify://widget-open');
  }

  static async getInitialWidgetOpenQuote() {
    try {
      const initialUrl = await Linking.getInitialURL();
      if (!this.isWidgetOpenUrl(initialUrl)) {
        return null;
      }

      return await this.getCurrentWidgetQuote();
    } catch (error) {
      console.error('Failed to resolve initial widget open quote:', error);
      return null;
    }
  }
}

export default WidgetService; 
