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
import InputSection from '../../features/chart-ai/components/InputSection';
import AiDashboard from '../../features/chart-ai/components/AiDashboard';
import { AiAnalysis } from '../../features/chart-ai/mockAiAnalysis';

type Mode = 'upload' | 'instrument';

/** Exact compact dashboard contract returned by /chart-analysis/dashboard. */
interface DashboardPayload {
  score?: number;
  status?: string;
  riskLevel?: string;
  confLevel?: string;
  insights?: { trend?: string; momentum?: string; liqBias?: string; sentiment?: string };
  gamePlan?: string;
  riskManagement?: { rrRatio?: string; stopLoss?: string; positionSize?: string };
  tradePlan?: {
    action?: string;
    whenToBuy?: string;
    whenToSell?: string;
    whenToExit?: string;
    stopLoss?: string;
    rrRatio?: string;
    positionSize?: string;
  };
  multiTimeframe?: { weekly?: string; daily?: string; h4?: string; h1?: string };
  smc?: { fvg?: string; bullishOb?: string; bearishOb?: string; buySideLiq?: string; sellSideLiq?: string };
  breakdown?: { title: string; content: string }[];
  error?: string;
}

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
  const [mode, setMode] = useState<Mode>(preselectedMarket ? 'instrument' : 'upload');
  const [aiImage, setAiImage] = useState<{ uri: string; base64: string | null } | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(preselectedMarket ?? null);
  const { settings } = useSettings();
  const [selectedTimeframe, setSelectedTimeframe] = useState(settings.defaultTimeframe);
  const [searchQuery, setSearchQuery] = useState('');
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [dashLoading, setDashLoading] = useState(false);
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

  /** Map the compact dashboard response into the display component's shape. */
  const toAiAnalysis = (d: DashboardPayload): AiAnalysis => ({
    score: d.score ?? 0,
    status: d.status ?? 'ANALYSIS INCOMPLETE',
    riskLevel: d.riskLevel ?? 'Medium',
    confidenceLevel: d.confLevel ?? 'Low',
    insights: {
      trend: d.insights?.trend ?? 'Neutral',
      momentum: d.insights?.momentum ?? 'Flat',
      liq_bias: d.insights?.liqBias ?? 'Neutral',
      sentiment: d.insights?.sentiment ?? 'Cautious',
    },
    gamePlan: d.gamePlan ?? '',
    riskManagement: {
      rrRatio: d.riskManagement?.rrRatio ?? '-',
      stopLoss: d.riskManagement?.stopLoss ?? '-',
      positionSize: d.riskManagement?.positionSize ?? '-',
    },
    tradePlan: {
      action: d.tradePlan?.action ?? 'WAIT',
      whenToBuy: d.tradePlan?.whenToBuy ?? '-',
      whenToSell: d.tradePlan?.whenToSell ?? '-',
      whenToExit: d.tradePlan?.whenToExit ?? '-',
      stopLoss: d.tradePlan?.stopLoss ?? '-',
      rrRatio: d.tradePlan?.rrRatio ?? '-',
      positionSize: d.tradePlan?.positionSize ?? '-',
    },
    multiTimeframe: {
      weekly: d.multiTimeframe?.weekly ?? 'Neutral',
      daily: d.multiTimeframe?.daily ?? 'Neutral',
      h4: d.multiTimeframe?.h4 ?? 'Consolidating',
      h1: d.multiTimeframe?.h1 ?? 'Range',
    },
    smc: {
      fvg: d.smc?.fvg ?? '-',
      bullishOb: d.smc?.bullishOb ?? '-',
      bearishOb: d.smc?.bearishOb ?? '-',
      buySideLiq: d.smc?.buySideLiq ?? '-',
      sellSideLiq: d.smc?.sellSideLiq ?? '-',
    },
    breakdown:
      d.breakdown?.map((b) => ({ title: b.title, content: b.content })) ?? [],
  });

  const runDashboard = async () => {
    setDashLoading(true);
    setDashboard(null);
    try {
      if (mode === 'upload' && aiImage?.base64) {
        const { data } = await aiClient.post('/chart-analysis/dashboard', {
          image_base64: aiImage.base64,
          mime_type: 'image/png',
        });
        setDashboard(data);
      } else if (mode === 'instrument' && selectedMarket) {
        const { data } = await aiClient.post('/chart-analysis/dashboard', {
          symbol: selectedMarket.symbol,
          timeframe_seconds: TIMEFRAMES[selectedTimeframe] ?? 3600,
          candle_count: settings.defaultCandleCount,
        });
        setDashboard(data);
      } else {
        setDashboard({ error: 'Select an image or instrument first.' });
      }
    } catch (e: any) {
      setDashboard({ error: e?.message ?? 'Analysis request failed.' });
    } finally {
      setDashLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bgPrimary }}>
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
      <AppHeader title="Technical Analysis" subtitle="AI-powered chart & indicator analysis" />

      {/* Mode Tabs */}
      <View style={{ flexDirection: 'row', marginBottom: 16, backgroundColor: COLORS.cardBg, borderRadius: 14, padding: 3, borderWidth: 1, borderColor: COLORS.subtleBorder }}>
        {(['upload', 'instrument'] as Mode[]).map((m) => (
          <TouchableOpacity
            key={m}
            onPress={() => { setMode(m); setDashboard(null); }}
            style={{ flex: 1, paddingVertical: 10, borderRadius: 11, backgroundColor: mode === m ? COLORS.purple : 'transparent', alignItems: 'center' }}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: mode === m ? COLORS.textPrimary : COLORS.textSecondary }}>
              {m === 'upload' ? '📷 Upload' : '📊 Instrument'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Upload Mode (AI dashboard) ─────────────────────────────── */}
      {mode === 'upload' && !aiImage && (
        <InputSection onImageSelected={(uri, base64) => { setAiImage({ uri, base64 }); setDashboard(null); }} />
      )}

      {mode === 'upload' && aiImage && (
        <>
          <View style={{ marginBottom: 16 }}>
            <Image source={{ uri: aiImage.uri }} style={{ width: '100%', height: 170, borderRadius: 14, borderWidth: 1, borderColor: COLORS.subtleBorder }} resizeMode="contain" />
            <TouchableOpacity onPress={() => { setAiImage(null); setDashboard(null); }} style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="close" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={runDashboard}
            disabled={dashLoading}
            style={{ backgroundColor: COLORS.purple, borderRadius: 14, paddingVertical: 13, alignItems: 'center', marginBottom: 16, opacity: dashLoading ? 0.5 : 1 }}
          >
            {dashLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontSize: 14.5, fontWeight: '700' }}>✨ Run AI Chart Analysis</Text>
            )}
          </TouchableOpacity>
          {dashboard?.error && (
            <View style={{ backgroundColor: COLORS.cardBg, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.subtleBorder, marginBottom: 16 }}>
              <Text style={{ color: COLORS.red, fontSize: 14 }}>{dashboard.error}</Text>
            </View>
          )}
          {dashboard && !dashboard.error && (
            <AiDashboard data={toAiAnalysis(dashboard)} />
          )}
        </>
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

      {/* ── Instrument: run + dashboard ────────────────────────────── */}
      {mode === 'instrument' && (
        <>
          <TouchableOpacity
            onPress={runDashboard}
            disabled={dashLoading || !selectedMarket}
            style={{ backgroundColor: COLORS.purple, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 20, opacity: dashLoading || !selectedMarket ? 0.5 : 1 }}
          >
            {dashLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Run AI Analysis</Text>
            )}
          </TouchableOpacity>

          {dashboard?.error && (
            <View style={{ backgroundColor: COLORS.cardBg, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.subtleBorder, marginBottom: 16 }}>
              <Text style={{ color: COLORS.red, fontSize: 14 }}>{dashboard.error}</Text>
            </View>
          )}

          {dashboard && !dashboard.error && (
            <AiDashboard data={toAiAnalysis(dashboard)} />
          )}
        </>
      )}
    </ScrollView>

    {/* ── Fixed bottom Pro button (Upload mode only) ─────────────── */}
    {mode === 'upload' && (
      <TouchableOpacity
        activeOpacity={0.9}
        style={{
          position: 'absolute',
          left: 20,
          right: 20,
          bottom: 24,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: COLORS.purple,
          borderRadius: 16,
          paddingVertical: 15,
          shadowColor: COLORS.purple,
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.45,
          shadowRadius: 12,
          elevation: 8,
        }}
      >
        <MaterialCommunityIcons name="lock-open-outline" size={18} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 14.5, fontWeight: '800', letterSpacing: 0.3 }}>
          Unlock AI Assistant (Pro)
        </Text>
      </TouchableOpacity>
    )}
    </View>
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
