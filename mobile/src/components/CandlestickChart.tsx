import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Text, View } from 'react-native';
import { Candle } from '../domain/entities/Candle';
import COLORS from '../theme/colors';

const CHART_PADDING = { top: 30, right: 58, bottom: 20, left: 12 };

function formatPrice(value: number) {
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

export default function CandlestickChart({ candles, livePrice, isLive }: { candles: Candle[]; livePrice?: number | null; isLive?: boolean }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const priceLineY = useRef(new Animated.Value(0)).current;
  const visibleCandles = useMemo(() => candles.slice(-48), [candles]);
  const range = useMemo(() => {
    const lows = visibleCandles.map((candle) => candle.low);
    const highs = visibleCandles.map((candle) => candle.high);
    const lowest = Math.min(...lows);
    const highest = Math.max(...highs);
    const padding = Math.max((highest - lowest) * 0.08, highest * 0.0001);
    return { min: lowest - padding, max: highest + padding };
  }, [visibleCandles]);

  const onLayout = ({ nativeEvent }: LayoutChangeEvent) => setSize(nativeEvent.layout);
  const plotWidth = Math.max(0, size.width - CHART_PADDING.left - CHART_PADDING.right);
  const plotHeight = Math.max(0, size.height - CHART_PADDING.top - CHART_PADDING.bottom);
  const priceToY = (price: number) => CHART_PADDING.top + ((range.max - price) / (range.max - range.min || 1)) * plotHeight;
  const candleSpace = plotWidth / Math.max(visibleCandles.length, 1);
  const bodyWidth = Math.max(3, Math.min(12, candleSpace * 0.62));
  const lastCandle = visibleCandles[visibleCandles.length - 1];
  const lastPriceY = lastCandle ? priceToY(lastCandle.close) : 0;
  useEffect(() => {
    if (!lastCandle || size.height === 0) return;
    Animated.timing(priceLineY, { toValue: lastPriceY, duration: 260, useNativeDriver: false }).start();
  }, [lastCandle, lastPriceY, priceLineY, size.height]);

  return (
    <View onLayout={onLayout} style={{ flex: 1, width: '100%', minHeight: 280, alignSelf: 'stretch' }}>
      {[0.2, 0.4, 0.6, 0.8].map((position) => (
        <View key={position} style={{ position: 'absolute', left: CHART_PADDING.left, right: CHART_PADDING.right, top: CHART_PADDING.top + plotHeight * position, height: 1, backgroundColor: COLORS.subtleBorder }} />
      ))}
      {visibleCandles.map((candle, index) => {
        const openY = priceToY(candle.open);
        const closeY = priceToY(candle.close);
        const highY = priceToY(candle.high);
        const lowY = priceToY(candle.low);
        const bullish = candle.close >= candle.open;
        const color = bullish ? COLORS.green : COLORS.red;
        const left = CHART_PADDING.left + index * candleSpace + (candleSpace - bodyWidth) / 2;
        return <React.Fragment key={`${candle.timestamp}-${index}`}>
          <View style={{ position: 'absolute', left: left + bodyWidth / 2 - 1, top: highY, width: 2, height: Math.max(1, lowY - highY), backgroundColor: color }} />
          <View style={{ position: 'absolute', left, top: Math.min(openY, closeY), width: bodyWidth, height: Math.max(2, Math.abs(closeY - openY)), borderRadius: 1, backgroundColor: color }} />
        </React.Fragment>;
      })}
      {lastCandle ? <>
        <Animated.View style={{ position: 'absolute', left: CHART_PADDING.left, right: CHART_PADDING.right, top: priceLineY, height: 1, borderStyle: 'dashed', borderWidth: 1, borderColor: 'rgba(117,87,247,0.65)' }} />
        <Animated.View style={{ position: 'absolute', right: 3, transform: [{ translateY: Animated.subtract(priceLineY, 11) }], borderRadius: 6, backgroundColor: COLORS.purple, paddingHorizontal: 5, paddingVertical: 3 }}><Text style={{ color: COLORS.textPrimary, fontSize: 9, fontWeight: '700' }}>{formatPrice(lastCandle.close)}</Text></Animated.View>
      </> : null}
      {[0, 0.5, 1].map((position) => {
        const price = range.max - (range.max - range.min) * position;
        return <Text key={position} style={{ position: 'absolute', right: 4, top: Math.max(CHART_PADDING.top - 8, priceToY(price) - 8), fontSize: 10, color: COLORS.textMuted }}>{formatPrice(price)}</Text>;
      })}
      <View style={{ position: 'absolute', top: 10, left: 14, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: isLive ? COLORS.green : COLORS.textMuted, marginRight: 6 }} />
        <Text style={{ fontSize: 11, color: isLive ? COLORS.green : COLORS.textMuted, fontWeight: isLive ? '700' : '400' }}>{isLive ? '● Live' : 'OHLC'}</Text>
      </View>
    </View>
  );
}
