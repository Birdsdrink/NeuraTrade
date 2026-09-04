import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import COLORS from '../../theme/colors';
import AppHeader from '../../components/AppHeader';
import { Market } from '../../domain/entities/Market';
import { useMarketDetail } from '../../features/markets/hooks/useMarketDetail';
import { analyseMarket } from '../../features/markets/services/marketAnalysis';
import { useMarkets } from '../../features/markets/hooks/useMarkets';

const TIMEFRAMES: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1H': 3600, '4H': 14400, '1D': 86400 };

function formatPrice(price: number) {
  return price >= 1000 ? price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : price >= 1 ? price.toFixed(4) : price.toFixed(6);
}

export default function AIAnalysisScreen({ navigation, market, timeframe }: { navigation: (screen: 'Markets' | 'MarketDetail' | 'AIAnalysis' | 'Watchlist' | 'FundamentalAnalysis' | 'Settings') => void; market: Market | null; timeframe: string }) {
  const [selectedTimeframe, setSelectedTimeframe] = useState(timeframe);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(market);
  const { data: availableMarkets = [] } = useMarkets();
  useEffect(() => {
    if (!selectedMarket && availableMarkets.length > 0) {
      setSelectedMarket(availableMarkets[0]);
    }
  }, [availableMarkets, selectedMarket]);
  const symbol = selectedMarket?.backendSymbol ?? selectedMarket?.symbol ?? '';
  const displayName = selectedMarket?.displayName ?? selectedMarket?.symbol ?? 'Market';
  const { data: candles = [], isLoading, isError, refetch } = useMarketDetail(symbol, TIMEFRAMES[selectedTimeframe] ?? 3600);
  const analysis = analyseMarket(candles);
  const directionColor = analysis?.direction === 'Bullish' ? COLORS.green : COLORS.red;

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
      <AppHeader title="Live Signal" subtitle={`${displayName} • ${selectedTimeframe}`} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
        {Object.keys(TIMEFRAMES).map((candidate) => (
          <TouchableOpacity
            key={candidate}
            onPress={() => setSelectedTimeframe(candidate)}
            style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: selectedTimeframe === candidate ? COLORS.purple : COLORS.cardBg, marginRight: 8, borderWidth: 1, borderColor: COLORS.subtleBorder }}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: selectedTimeframe === candidate ? COLORS.textPrimary : COLORS.textSecondary }}>{candidate}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Text style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 8 }}>ANALYSE MARKET</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
        {(availableMarkets.length > 0 ? availableMarkets : selectedMarket ? [selectedMarket] : []).map((candidate) => {
          const active = candidate.symbol === selectedMarket?.symbol;
          return <TouchableOpacity
            key={candidate.symbol}
            onPress={() => setSelectedMarket(candidate)}
            style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: active ? COLORS.blue : COLORS.cardBg, marginRight: 8, borderWidth: 1, borderColor: COLORS.subtleBorder }}
          >
            <Text style={{ fontSize: 12, fontWeight: '600', color: active ? COLORS.textPrimary : COLORS.textSecondary }}>{candidate.displayName ?? candidate.symbol}</Text>
          </TouchableOpacity>;
        })}
      </ScrollView>

      <Text style={{ color: COLORS.textMuted, fontSize: 11, marginTop: -8, marginBottom: 16 }}>Live analysis refreshes every 30 seconds.</Text>

      {isLoading ? <Text style={{ color: COLORS.textSecondary }}>Loading {selectedTimeframe} market data…</Text> : null}
      {isError ? <TouchableOpacity onPress={() => refetch()}><Text style={{ color: COLORS.textSecondary }}>Analysis data is unavailable. Tap to retry.</Text></TouchableOpacity> : null}
      {!isLoading && !isError && !analysis ? <Text style={{ color: COLORS.textSecondary }}>At least 21 candles are needed to calculate this analysis.</Text> : null}

      {analysis ? <>
        <View style={{ backgroundColor: COLORS.cardBg, borderRadius: 22, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: COLORS.subtleBorder }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <MaterialCommunityIcons name="star-four-points" size={20} color={COLORS.purple} />
            <Text style={{ color: COLORS.purple, fontWeight: '600', fontSize: 13, marginLeft: 6 }}>TIMEFRAME SIGNAL</Text>
          </View>
          <Text style={{ fontSize: 22, fontWeight: 'bold', color: directionColor, marginVertical: 8 }}>{analysis.direction}</Text>
          <Text style={{ color: COLORS.textSecondary, fontSize: 13, lineHeight: 18 }}>{analysis.summary}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: COLORS.subtleBorder }}>
            <Text style={{ fontSize: 12, color: COLORS.textMuted }}>Signal confidence</Text>
            <Text style={{ fontSize: 16, fontWeight: 'bold', color: directionColor }}>{analysis.confidence}%</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
          <Metric label="TREND" value={analysis.direction} detail="10 / 20 candle averages" color={directionColor} />
          <Metric label="MOMENTUM" value={analysis.rsi >= 50 ? 'Positive' : 'Negative'} detail={`RSI ${analysis.rsi.toFixed(1)}`} color={analysis.rsi >= 50 ? COLORS.green : COLORS.red} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Metric label="VOLATILITY" value={analysis.volatility} detail="Recent candle movement" color={COLORS.yellow} />
          <Metric label="TIMEFRAME" value={selectedTimeframe} detail={`${candles.length} backend candles`} color={COLORS.purple} />
        </View>
        <View style={{ backgroundColor: COLORS.cardBg, borderRadius: 18, padding: 16, marginTop: 12, borderWidth: 1, borderColor: COLORS.subtleBorder }}>
          <Text style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 10 }}>SUPPORT & RESISTANCE</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ fontSize: 12, color: COLORS.textMuted }}>Support</Text>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: COLORS.green, marginTop: 3 }}>{formatPrice(analysis.support)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 12, color: COLORS.textMuted }}>Resistance</Text>
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: COLORS.red, marginTop: 3 }}>{formatPrice(analysis.resistance)}</Text>
            </View>
          </View>
          <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 12, lineHeight: 17 }}>
            Current price {formatPrice(analysis.currentPrice)} is {Math.abs(analysis.currentPrice - analysis.support) <= Math.abs(analysis.resistance - analysis.currentPrice) ? 'closer to support' : 'closer to resistance'} on the {selectedTimeframe} timeframe. Levels use the most recent {Math.min(candles.length, 40)} candles.
          </Text>
        </View>
      </> : null}
    </ScrollView>
  );
}

function Metric({ label, value, detail, color }: { label: string; value: string; detail: string; color: string }) {
  return <View style={{ flex: 1, backgroundColor: COLORS.cardBg, borderRadius: 18, padding: 16, marginHorizontal: 4, borderWidth: 1, borderColor: COLORS.subtleBorder }}>
    <Text style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 4 }}>{label}</Text>
    <Text style={{ fontSize: 16, fontWeight: 'bold', color, marginVertical: 4 }}>{value}</Text>
    <Text style={{ fontSize: 12, color: COLORS.textMuted }}>{detail}</Text>
  </View>;
}
