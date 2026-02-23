import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const formatDateTime = (value) => {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return date.toLocaleString();
};

const labelForMode = (mode) => (mode === 'custom' ? 'Custom API' : 'Built-in');

const DataSourceSettings = ({
  visible,
  onClose,
  sourceInfo,
  onApplyEndpoint,
  onRefresh,
  onUseBuiltIn,
}) => {
  const [endpointInput, setEndpointInput] = useState(sourceInfo?.endpoint || '');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (visible) {
      setEndpointInput(sourceInfo?.endpoint || '');
      setLocalError('');
    }
  }, [visible, sourceInfo?.endpoint]);

  const statusText = useMemo(() => {
    switch (sourceInfo?.status) {
      case 'loading':
        return 'Loading';
      case 'refreshing':
        return 'Refreshing';
      case 'error':
        return 'Error';
      case 'ready':
        return 'Ready';
      default:
        return 'Idle';
    }
  }, [sourceInfo?.status]);

  const handleApply = async () => {
    setSubmitting(true);
    setLocalError('');
    try {
      await onApplyEndpoint(endpointInput);
    } catch (error) {
      setLocalError(error?.message || 'Failed to apply endpoint.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setLocalError('');
    try {
      await onRefresh();
    } catch (error) {
      setLocalError(error?.message || 'Failed to refresh custom source.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleUseBuiltIn = async () => {
    setSubmitting(true);
    setLocalError('');
    try {
      await onUseBuiltIn();
    } catch (error) {
      setLocalError(error?.message || 'Failed to switch to built-in source.');
    } finally {
      setSubmitting(false);
    }
  };

  const effectiveError = localError || sourceInfo?.error?.message || '';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.headerButtonText}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Data Source</Text>
          <View style={styles.headerButtonPlaceholder} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Current Source</Text>

            <View style={styles.row}>
              <Text style={styles.label}>Using</Text>
              <Text style={styles.value}>{labelForMode(sourceInfo?.activeMode)}</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Configured</Text>
              <Text style={styles.value}>{labelForMode(sourceInfo?.configuredMode)}</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Status</Text>
              <Text style={styles.value}>{statusText}{sourceInfo?.usingCache ? ' (cache)' : ''}</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Quotes</Text>
              <Text style={styles.value}>{sourceInfo?.datasetCount ?? 0}</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Last Updated</Text>
              <Text style={styles.valueSmall}>{formatDateTime(sourceInfo?.lastUpdatedAt)}</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Last Attempt</Text>
              <Text style={styles.valueSmall}>{formatDateTime(sourceInfo?.lastRefreshAttemptAt)}</Text>
            </View>

            {sourceInfo?.endpoint ? (
              <View style={styles.endpointContainer}>
                <Text style={styles.label}>Endpoint</Text>
                <Text style={styles.endpointText}>{sourceInfo.endpoint}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Custom HTTPS Endpoint</Text>
            <Text style={styles.helperText}>
              The endpoint must return a JSON body with a `quotes` array. Only `https://` URLs are allowed.
            </Text>
            <TextInput
              style={styles.input}
              value={endpointInput}
              onChangeText={setEndpointInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://example.com/quotes.json"
              placeholderTextColor="#9AA1AC"
            />

            {effectiveError ? (
              <Text style={styles.errorText}>{effectiveError}</Text>
            ) : null}

            <TouchableOpacity
              style={[styles.primaryButton, (submitting || refreshing) && styles.disabledButton]}
              onPress={handleApply}
              activeOpacity={0.8}
              disabled={submitting || refreshing}
            >
              {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Apply Custom Source</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, refreshing && styles.disabledButton]}
              onPress={handleRefresh}
              activeOpacity={0.8}
              disabled={refreshing || !sourceInfo?.endpoint}
            >
              {refreshing ? <ActivityIndicator color="#1B4D9C" /> : <Text style={styles.secondaryButtonText}>Refresh Current Source</Text>}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.ghostButton}
              onPress={handleUseBuiltIn}
              activeOpacity={0.8}
              disabled={submitting || refreshing}
            >
              <Text style={styles.ghostButtonText}>Use Built-in Dataset</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FB',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 12 : 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E3E8F0',
    backgroundColor: '#FFFFFF',
  },
  headerButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
    minWidth: 52,
  },
  headerButtonPlaceholder: {
    minWidth: 52,
  },
  headerButtonText: {
    color: '#1B4D9C',
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  content: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E6ECF5',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 12,
  },
  label: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '600',
  },
  value: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
  },
  valueSmall: {
    flex: 1,
    textAlign: 'right',
    fontSize: 13,
    color: '#111827',
  },
  endpointContainer: {
    marginTop: 8,
    backgroundColor: '#F7FAFF',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E0EAFE',
  },
  endpointText: {
    marginTop: 4,
    fontSize: 12,
    color: '#1F2937',
  },
  helperText: {
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 18,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D9E6',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: '#111827',
    marginBottom: 10,
  },
  errorText: {
    color: '#B42318',
    backgroundColor: '#FFF1F0',
    borderWidth: 1,
    borderColor: '#FFD1CC',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    fontSize: 13,
  },
  primaryButton: {
    backgroundColor: '#1B4D9C',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    minHeight: 48,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  secondaryButton: {
    backgroundColor: '#EEF4FF',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    minHeight: 48,
  },
  secondaryButtonText: {
    color: '#1B4D9C',
    fontWeight: '700',
    fontSize: 14,
  },
  ghostButton: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D1D9E6',
    minHeight: 48,
  },
  ghostButtonText: {
    color: '#374151',
    fontWeight: '600',
    fontSize: 14,
  },
  disabledButton: {
    opacity: 0.6,
  },
});

export default DataSourceSettings;

