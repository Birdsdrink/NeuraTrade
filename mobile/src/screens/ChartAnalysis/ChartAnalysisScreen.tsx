import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, TextInput,
  ActivityIndicator, Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import COLORS from '../../theme/colors';
import AppHeader from '../../components/AppHeader';
import { useMarkets } from '../../features/markets/hooks/useMarkets';
import { Market } from '../../domain/entities/Market';
import { aiClient } from '../../services/api/apiClient';
import { useSettings } from '../../hooks/useSettings';
import AiDashboard from '../../features/chart-ai/components/AiDashboard';
import { AiAnalysis } from '../../features/chart-ai/mockAiAnalysis';

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
  warnings?: string[];
  error?: string;
}

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
      if (selectedMarket) {
        const { data } = await aiClient.post('/chart-analysis/dashboard', {
          symbol: selectedMarket.symbol,
          timeframe_seconds: TIMEFRAMES[selectedTimeframe] ?? 3600,
          candle_count: settings.defaultCandleCount,
        });
        setDashboard(data);
      } else {
        setDashboard({ error: 'Select an instrument first.' });
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

        {/* ── Instrument Selector ─────────────────────────────────── */}
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

        {/* ── Run Analysis ────────────────────────────────────────── */}
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
      </ScrollView>
    </View>
  );
}
