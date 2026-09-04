import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import COLORS from '../../theme/colors';
import AppHeader from '../../components/AppHeader';
import { useMarketDetail } from '../../features/markets/hooks/useMarketDetail';
import { useLiveCandles } from '../../features/markets/hooks/useLiveCandles';
import { useLiveTick } from '../../features/markets/hooks/useLiveTick';
import { Market } from '../../domain/entities/Market';
import { useSettings } from '../../hooks/useSettings';
import CandlestickChart from '../../components/CandlestickChart';

const TIMEFRAMES: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1H': 3600,
  '4H': 14400,
  '1D': 86400,
};

export default function MarketDetailScreen({ navigation, market, onOpenAnalysis }: {
  navigation: (screen: 'Markets' | 'MarketDetail' | 'AIAnalysis' | 'Watchlist' | 'FundamentalAnalysis' | 'Settings') => void;
  market: Market | null;
  onOpenAnalysis: (timeframe: string) => void;
}) {
  const { settings } = useSettings();
  const [timeframe, setTimeframe] = useState(settings.defaultTimeframe);
  const symbol = market?.backendSymbol ?? market?.symbol ?? '';
  const displayName = market?.displayName ?? market?.symbol ?? 'Market';

  // Historical candles from REST API (refetches every 30s as backup)
  const { data: historicalCandles = [], isLoading, isError, refetch } = useMarketDetail(symbol, TIMEFRAMES[timeframe] ?? 3600, settings.defaultCandleCount, settings.refreshInterval);

  // Live candles: historical base + real-time tick updates via WebSocket
  const { candles } = useLiveCandles(symbol, TIMEFRAMES[timeframe] ?? 3600, historicalCandles);

  // Raw live tick for the current price line
  const { livePrice, isLive } = useLiveTick(symbol);

  const latestCandle = candles[candles.length - 1];
  const firstCandle = candles[0];
  const currentPrice = livePrice ?? latestCandle?.close ?? null;
  const change = latestCandle && firstCandle && firstCandle.close !== 0
    ? ((latestCandle.close - firstCandle.close) / firstCandle.close) * 100
    : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: COLORS.bgPrimary }} contentContainerStyle={{ paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
      {/* Detail Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: COLORS.subtleBorder }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity onPress={() => navigation('Markets')} style={{ padding: 4, marginRight: 8 }}>
              <Ionicons name="arrow-back" size={20} color={COLORS.textPrimary} />
            </TouchableOpacity>
            <Image source={require('../../../assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 8, marginRight: 8 }} />
            <View>
              <Text style={{ fontSize: 14, fontWeight: '800' }}>
                <Text style={{ color: COLORS.blue }}>Neura</Text>
                <Text style={{ color: COLORS.green }}>Trade</Text>
              </Text>
              <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 1 }}>{displayName}</Text>
            </View>
          </View>
          <TouchableOpacity style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.cardBg, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.subtleBorder }}>
            <Ionicons name="notifications-outline" size={16} color={COLORS.textPrimary} />
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
          {isLive && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green, marginRight: 5 }} />}
          <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.textPrimary }}>
            {currentPrice != null ? currentPrice.toFixed(5) : 'Loading…'}
          </Text>
          {change !== null && (
            <Text style={{ color: change >= 0 ? COLORS.green : COLORS.red, fontSize: 14, fontWeight: '600', marginLeft: 8 }}>
              {change >= 0 ? '+' : ''}{change.toFixed(2)}%
            </Text>
          )}
        </View>
      </View>

      {/* Timeframe Selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        {Object.keys(TIMEFRAMES).map((tf) => (
          <TouchableOpacity
            key={tf}
            style={{
              paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999,
              backgroundColor: timeframe === tf ? COLORS.purple : COLORS.cardBg,
              marginRight: 8, height: 32, justifyContent: 'center',
              borderWidth: 1, borderColor: timeframe === tf ? COLORS.purple : COLORS.subtleBorder,
            }}
            onPress={() => setTimeframe(tf)}
          >
            <Text style={{ fontSize: 12, color: timeframe === tf ? COLORS.textPrimary : COLORS.textSecondary, fontWeight: '600' }}>{tf}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Candlestick chart — real-time */}
      <View style={{ backgroundColor: COLORS.cardBg, marginHorizontal: 16, marginBottom: 16, borderRadius: 20, height: 340, borderWidth: 1, borderColor: COLORS.subtleBorder, overflow: 'hidden' }}>
        <View style={{ flex: 1, width: '100%', alignSelf: 'stretch' }}>
          {candles.length > 0 ? (
            <CandlestickChart candles={candles} livePrice={livePrice} isLive={isLive} />
          ) : isError ? (
            <TouchableOpacity onPress={() => refetch()} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <MaterialCommunityIcons name="cloud-off-outline" size={32} color={COLORS.textMuted} />
              <Text style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 8 }}>Could not load data. Tap to retry.</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>{isLoading ? 'Loading market data…' : 'No candle data available.'}</Text>
            </View>
          )}
        </View>
      </View>

      {/* AI Action Buttons */}
      <View style={{ paddingHorizontal: 16 }}>
        <Text style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10 }}>AI TOOLS FOR {displayName.toUpperCase()}</Text>

        {/* Live Signal — Real-time AI analysis */}
        <TouchableOpacity
          style={{ backgroundColor: COLORS.cardBg, height: 48, borderRadius: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: COLORS.subtleBorder }}
          onPress={() => onOpenAnalysis(timeframe)}
        >
          <MaterialCommunityIcons name="star-four-points" size={16} color={COLORS.textPrimary} />
          <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 14, marginLeft: 8 }}>Live Signal</Text>
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, marginLeft: 6 }}>Real-time AI analysis</Text>
        </TouchableOpacity>

        {/* Technical Analysis — Vision & Indicators */}
        <TouchableOpacity
          style={{ backgroundColor: COLORS.cardBg, height: 48, borderRadius: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: COLORS.subtleBorder }}
          onPress={() => navigation('Watchlist')}
        >
          <MaterialCommunityIcons name="chart-timeline-variant" size={16} color={COLORS.cyan} />
          <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 14, marginLeft: 8 }}>Technicals</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 11, marginLeft: 6 }}>AI chart & indicator analysis</Text>
        </TouchableOpacity>

        {/* Fundamental Analysis — News Sentiment */}
        <TouchableOpacity
          style={{ backgroundColor: COLORS.cardBg, height: 48, borderRadius: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.subtleBorder }}
          onPress={() => navigation('FundamentalAnalysis')}
        >
          <MaterialCommunityIcons name="newspaper-variant-outline" size={16} color={COLORS.yellow} />
          <Text style={{ color: COLORS.textPrimary, fontWeight: '700', fontSize: 14, marginLeft: 8 }}>Fundamental</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 11, marginLeft: 6 }}>News sentiment</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
