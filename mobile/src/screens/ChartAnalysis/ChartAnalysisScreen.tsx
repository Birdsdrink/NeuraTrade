import React, { useState, useEffect } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, TextInput,
  ActivityIndicator, Image, Platform, Alert,
} from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import COLORS from '../../theme/colors';
import AppHeader from '../../components/AppHeader';
import { useMarkets } from '../../features/markets/hooks/useMarkets';
import { Market } from '../../domain/entities/Market';
import { aiClient } from '../../services/api/apiClient';
import { useSettings } from '../../hooks/useSettings';

type Mode = 'image' | 'instrument';

type AnalysisResult = {
  symbol?: string;
  timeframe?: string;
  current_price?: number | null;
  market_direction?: string;
  trend_strength?: number;
  market_structure?: { higher_highs?: boolean; higher_lows?: boolean; lower_highs?: boolean; lower_lows?: boolean };
  support_levels?: number[];
  resistance_levels?: number[];
  candlestick_patterns?: string[];
  chart_patterns?: string[];
  indicators?: {
    rsi?: number | null;
    macd?: number | null;
    moving_averages?: string[];
    bollinger_bands?: string | null;
    stochastic?: number | null;
    volume?: string | null;
  };
  analysis?: string;
  setup?: {
    direction?: string;
    entry_zone?: string | null;
    stop_loss?: string | null;
    take_profit_1?: string | null;
    take_profit_2?: string | null;
    risk_reward?: string | null;
  };
  confidence?: number;
  reasons?: string[];
  warnings?: string[];
  // Legacy fallback fields
  direction?: string;
  summary?: string;
  key_levels?: { support?: string; resistance?: string };
  pattern?: string;
  timeframe_hint?: string;
  risk_note?: string;
  error?: string;
};

const TIMEFRAMES: Record<string, number> = {
  '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1H': 3600, '4H': 14400, '1D': 86400,
};

export default function ChartAnalysisScreen({
  navigation,
  preselectedMarket,
}: {
  navigation: (screen: 'Markets' | 'MarketDetail' | 'AIAnalysis' | 'Watchlist' | 'FundamentalAnalysis' | 'Settings') => void;
  preselectedMarket?: Market | null;
}) {
  const [mode, setMode] = useState<Mode>(preselectedMarket ? 'instrument' : 'image');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(preselectedMarket ?? null);
  const { settings } = useSettings();
  const [selectedTimeframe, setSelectedTimeframe] = useState(settings.defaultTimeframe);
  const [searchQuery, setSearchQuery] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const { data: markets = [] } = useMarkets();

  const filteredMarkets = searchQuery.trim()
    ? markets.filter((m) => {
        const q = searchQuery.toLowerCase();
        return (
          m.symbol.toLowerCase().includes(q) ||
          (m.displayName ?? '').toLowerCase().includes(q) ||
          (m.market ?? '').toLowerCase().includes(q)
        );
      })
    : markets;

  const dir = (result?.market_direction ?? result?.direction ?? '').toLowerCase();
  const directionColor =
    dir === 'bullish'
      ? COLORS.green
      : dir === 'bearish'
      ? COLORS.red
      : COLORS.yellow;
  const setupDir = (result?.setup?.direction ?? '').toUpperCase();
  const setupColor = setupDir === 'BUY' ? COLORS.green : setupDir === 'SELL' ? COLORS.red : COLORS.yellow;

  const pickImage = async () => {
    try {
      const ImagePicker = await import('expo-image-picker');
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please grant photo library access to upload chart images.');
        return;
      }
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.85,
        base64: true,
      });
      if (!pickerResult.canceled && pickerResult.assets[0]) {
        const asset = pickerResult.assets[0];
        setImageUri(asset.uri);
        setImageBase64(asset.base64 ?? null);
      }
    } catch {
      Alert.alert(
        'expo-image-picker not installed',
        'Run: npx expo install expo-image-picker\nThen restart the app.',
      );
    }
  };

  const takePhoto = async () => {
    try {
      const ImagePicker = await import('expo-image-picker');
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Please grant camera access to photograph charts.');
        return;
      }
      const cameraResult = await ImagePicker.launchCameraAsync({
        quality: 0.85,
        base64: true,
      });
      if (!cameraResult.canceled && cameraResult.assets[0]) {
        const asset = cameraResult.assets[0];
        setImageUri(asset.uri);
        setImageBase64(asset.base64 ?? null);
      }
    } catch {
      Alert.alert(
        'expo-image-picker not installed',
        'Run: npx expo install expo-image-picker\nThen restart the app.',
      );
    }
  };

  const runAnalysis = async () => {
    setLoading(true);
    setResult(null);
    try {
      if (mode === 'image' && imageBase64) {
        const { data } = await aiClient.post('/chart-analysis', {
          image_base64: imageBase64,
          mime_type: 'image/png',
        });
        setResult(data);
      } else if (mode === 'instrument' && selectedMarket) {
        const { data } = await aiClient.post('/chart-analysis', {
          symbol: selectedMarket.symbol,
          timeframe_seconds: TIMEFRAMES[selectedTimeframe] ?? 3600,
          candle_count: settings.defaultCandleCount,
        });
        setResult(data);
      } else {
        setResult({ error: 'Select an image or instrument first.' });
      }
    } catch (e: any) {
      setResult({ error: e?.message ?? 'Analysis request failed.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
      <AppHeader title="Technical Analysis" subtitle="AI-powered chart & indicator analysis" />

      {/* Mode Tabs */}
      <View style={{ flexDirection: 'row', marginBottom: 16, backgroundColor: COLORS.cardBg, borderRadius: 14, padding: 3, borderWidth: 1, borderColor: COLORS.subtleBorder }}>
        {(['image', 'instrument'] as Mode[]).map((m) => (
          <TouchableOpacity
            key={m}
            onPress={() => { setMode(m); setResult(null); }}
            style={{ flex: 1, paddingVertical: 10, borderRadius: 11, backgroundColor: mode === m ? COLORS.purple : 'transparent', alignItems: 'center' }}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: mode === m ? COLORS.textPrimary : COLORS.textSecondary }}>
              {m === 'image' ? '📷 Upload Chart' : '📊 Pick Instrument'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Image Mode ─────────────────────────────────────────────── */}
      {mode === 'image' && (
        <View style={{ marginBottom: 20 }}>
          <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>CHART IMAGE</Text>
          {imageUri ? (
            <View style={{ marginBottom: 12 }}>
              <Image source={{ uri: imageUri }} style={{ width: '100%', height: 200, borderRadius: 14, borderWidth: 1, borderColor: COLORS.subtleBorder }} resizeMode="contain" />
              <TouchableOpacity onPress={() => { setImageUri(null); setImageBase64(null); setResult(null); }} style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="close" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              <TouchableOpacity onPress={pickImage} style={{ flex: 1, backgroundColor: COLORS.cardBg, borderRadius: 14, padding: 20, borderWidth: 1, borderColor: COLORS.subtleBorder, alignItems: 'center' }}>
                <MaterialCommunityIcons name="image-plus" size={32} color={COLORS.purple} />
                <Text style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 8 }}>Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={takePhoto} style={{ flex: 1, backgroundColor: COLORS.cardBg, borderRadius: 14, padding: 20, borderWidth: 1, borderColor: COLORS.subtleBorder, alignItems: 'center' }}>
                <MaterialCommunityIcons name="camera" size={32} color={COLORS.purple} />
                <Text style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 8 }}>Camera</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* ── Instrument Mode ────────────────────────────────────────── */}
      {mode === 'instrument' && (
        <View style={{ marginBottom: 20 }}>
          <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>SELECT INSTRUMENT</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.cardBg, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, borderWidth: 1, borderColor: COLORS.subtleBorder }}>
            <MaterialCommunityIcons name="magnify" size={18} color={COLORS.textMuted} style={{ marginRight: 8 }} />
            <TextInput
              placeholder="Search instruments…"
              placeholderTextColor={COLORS.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={{ flex: 1, color: COLORS.textPrimary, fontSize: 14, padding: 0 }}
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <MaterialCommunityIcons name="close-circle" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView style={{ maxHeight: 200, marginBottom: 12 }} showsVerticalScrollIndicator={false}>
            {filteredMarkets.slice(0, 50).map((m) => {
              const active = m.symbol === selectedMarket?.symbol;
              return (
                <TouchableOpacity
                  key={m.symbol}
                  onPress={() => setSelectedMarket(m)}
                  style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: active ? COLORS.purple : COLORS.cardBg, marginBottom: 4, borderWidth: 1, borderColor: active ? COLORS.purple : COLORS.subtleBorder }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: active ? COLORS.textPrimary : COLORS.textSecondary }}>
                    {m.displayName ?? m.symbol}
                  </Text>
                  <Text style={{ fontSize: 11, color: active ? 'rgba(255,255,255,0.7)' : COLORS.textMuted, marginTop: 2 }}>
                    {m.symbol} · {m.market ?? ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>TIMEFRAME</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
            {Object.keys(TIMEFRAMES).map((tf) => (
              <TouchableOpacity
                key={tf}
                onPress={() => setSelectedTimeframe(tf)}
                style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: selectedTimeframe === tf ? COLORS.purple : COLORS.cardBg, marginRight: 8, borderWidth: 1, borderColor: COLORS.subtleBorder }}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: selectedTimeframe === tf ? COLORS.textPrimary : COLORS.textSecondary }}>{tf}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Analyse Button ─────────────────────────────────────────── */}
      <TouchableOpacity
        onPress={runAnalysis}
        disabled={loading || (mode === 'image' && !imageBase64) || (mode === 'instrument' && !selectedMarket)}
        style={{ backgroundColor: COLORS.purple, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 20, opacity: loading || (mode === 'image' && !imageBase64) || (mode === 'instrument' && !selectedMarket) ? 0.5 : 1 }}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Run AI Analysis</Text>
        )}
      </TouchableOpacity>

      {/* ── Results ─────────────────────────────────────────────────── */}
      {result?.error && (
        <View style={{ backgroundColor: COLORS.cardBg, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.subtleBorder, marginBottom: 16 }}>
          <Text style={{ color: COLORS.red, fontSize: 14 }}>{result.error}</Text>
        </View>
      )}

      {result && !result.error && (
        <>
          {/* ── Direction & Confidence ── */}
          <Card>
            <Row><MaterialCommunityIcons name="brain" size={20} color={COLORS.purple} /><Label style={{ marginLeft: 6 }}>AI TECHNICAL ANALYSIS</Label></Row>
            {result.symbol ? <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 4 }}>{result.symbol} · {result.timeframe ?? ''} {result.current_price != null ? `· ${result.current_price}` : ''}</Text> : null}
            <Text style={{ fontSize: 22, fontWeight: 'bold', color: directionColor, marginVertical: 8 }}>{(result.market_direction ?? result.direction ?? 'Unknown')}</Text>
            <Text style={{ color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 }}>{result.analysis ?? result.summary ?? ''}</Text>
            <Divider />
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>Confidence</Text>
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: directionColor }}>{result.confidence ?? 0}%</Text>
            </Row>
            {result.trend_strength != null && result.trend_strength > 0 && (
              <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>Trend Strength</Text>
                <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.textPrimary }}>{result.trend_strength}/100</Text>
              </Row>
            )}
          </Card>

          {/* ── Setup Card ── */}
          {result.setup && result.setup.direction && (
            <Card>
              <Row><MaterialCommunityIcons name="crosshairs-gps" size={18} color={setupColor} /><Label style={{ color: setupColor, marginLeft: 6 }}>SETUP: {setupDir}</Label></Row>
              {result.setup.entry_zone && <KV k="Entry Zone" v={result.setup.entry_zone} />}
              {result.setup.stop_loss && <KV k="Stop Loss" v={result.setup.stop_loss} color={COLORS.red} />}
              {result.setup.take_profit_1 && <KV k="Take Profit 1" v={result.setup.take_profit_1} color={COLORS.green} />}
              {result.setup.take_profit_2 && <KV k="Take Profit 2" v={result.setup.take_profit_2} color={COLORS.green} />}
              {result.setup.risk_reward && <KV k="Risk / Reward" v={result.setup.risk_reward} />}
            </Card>
          )}

          {/* ── Support & Resistance ── */}
          {(result.support_levels?.length ?? 0) > 0 || (result.resistance_levels?.length ?? 0) > 0 ? (
            <Card>
              <Label>SUPPORT & RESISTANCE</Label>
              <Row style={{ marginTop: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.green, fontSize: 12, fontWeight: '600', marginBottom: 4 }}>Support</Text>
                  {(result.support_levels ?? []).map((lv, i) => <Text key={i} style={{ color: COLORS.textPrimary, fontSize: 14 }}>{lv}</Text>)}
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={{ color: COLORS.red, fontSize: 12, fontWeight: '600', marginBottom: 4 }}>Resistance</Text>
                  {(result.resistance_levels ?? []).map((lv, i) => <Text key={i} style={{ color: COLORS.textPrimary, fontSize: 14 }}>{lv}</Text>)}
                </View>
              </Row>
            </Card>
          ) : null}

          {/* ── Market Structure ── */}
          {result.market_structure ? (
            <Card>
              <Label>MARKET STRUCTURE</Label>
              <Row style={{ marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
                {result.market_structure.higher_highs && <Pill text="Higher Highs" color={COLORS.green} />}
                {result.market_structure.higher_lows && <Pill text="Higher Lows" color={COLORS.green} />}
                {result.market_structure.lower_highs && <Pill text="Lower Highs" color={COLORS.red} />}
                {result.market_structure.lower_lows && <Pill text="Lower Lows" color={COLORS.red} />}
                {!result.market_structure.higher_highs && !result.market_structure.higher_lows && !result.market_structure.lower_highs && !result.market_structure.lower_lows && (
                  <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>Not determined</Text>
                )}
              </Row>
            </Card>
          ) : null}

          {/* ── Indicators ── */}
          {result.indicators ? (
            <Card>
              <Label>INDICATORS</Label>
              {result.indicators.rsi != null && <KV k="RSI" v={`${result.indicators.rsi}`} />}
              {result.indicators.macd != null && <KV k="MACD" v={`${result.indicators.macd}`} />}
              {result.indicators.stochastic != null && <KV k="Stochastic" v={`${result.indicators.stochastic}`} />}
              {result.indicators.bollinger_bands && <KV k="Bollinger Bands" v={result.indicators.bollinger_bands} />}
              {result.indicators.volume && <KV k="Volume" v={result.indicators.volume} />}
              {(result.indicators.moving_averages ?? []).length > 0 && (
                <View style={{ marginTop: 6 }}>
                  <Text style={{ color: COLORS.textMuted, fontSize: 11, marginBottom: 2 }}>Moving Averages</Text>
                  {(result.indicators.moving_averages ?? []).map((ma, i) => <Text key={i} style={{ color: COLORS.textPrimary, fontSize: 13 }}>{ma}</Text>)}
                </View>
              )}
            </Card>
          ) : null}

          {/* ── Patterns ── */}
          {((result.chart_patterns?.length ?? 0) > 0 || (result.candlestick_patterns?.length ?? 0) > 0) ? (
            <Card>
              <Label>PATTERNS</Label>
              {(result.chart_patterns ?? []).map((p, i) => <Pill key={'cp'+i} text={p} color={COLORS.cyan} />)}
              {(result.candlestick_patterns ?? []).map((p, i) => <Pill key={'cs'+i} text={p} color={COLORS.yellow} />)}
            </Card>
          ) : null}

          {/* ── Reasons ── */}
          {(result.reasons?.length ?? 0) > 0 ? (
            <Card>
              <Label>SUPPORTING REASONS</Label>
              {(result.reasons ?? []).map((r, i) => (
                <Text key={i} style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 4, lineHeight: 18 }}>• {r}</Text>
              ))}
            </Card>
          ) : null}

          {/* ── Warnings ── */}
          {(result.warnings?.length ?? 0) > 0 ? (
            <Card style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
              <Row><MaterialCommunityIcons name="alert-outline" size={16} color={COLORS.red} /><Label style={{ color: COLORS.red, marginLeft: 6 }}>WARNINGS</Label></Row>
              {(result.warnings ?? []).map((w, i) => (
                <Text key={i} style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 17 }}>⚠ {w}</Text>
              ))}
            </Card>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

// ── Tiny layout helpers ─────────────────────────────────────────────────────
const Card = ({ children, style }: { children: React.ReactNode; style?: any }) => (
  <View style={{ backgroundColor: COLORS.cardBg, borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: COLORS.subtleBorder, ...style }}>{children}</View>
);
const Row = ({ children, style }: { children: React.ReactNode; style?: any }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', ...style }}>{children}</View>
);
const Label = ({ children, style }: { children: React.ReactNode; style?: any }) => (
  <Text style={{ color: COLORS.purple, fontWeight: '600', fontSize: 12, ...style }}>{children}</Text>
);
const Divider = () => (
  <View style={{ borderTopWidth: 1, borderTopColor: COLORS.subtleBorder, marginVertical: 12 }} />
);
const KV = ({ k, v, color }: { k: string; v: string; color?: string }) => (
  <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
    <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>{k}</Text>
    <Text style={{ color: color ?? COLORS.textPrimary, fontSize: 13, fontWeight: '600' }}>{v}</Text>
  </Row>
);
const Pill = ({ text, color }: { text: string; color: string }) => (
  <View style={{ backgroundColor: color + '20', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginRight: 6, marginBottom: 6 }}>
    <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{text}</Text>
  </View>
);
