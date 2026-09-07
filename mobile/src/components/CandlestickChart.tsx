import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Line, Rect, Circle, Text as SvgText, G } from 'react-native-svg';
import { Candle } from '../domain/entities/Candle';
import COLORS from '../theme/colors';

const CHART_BG = COLORS.bgPrimary;
const GRID_COLOR = COLORS.subtleBorder;
const TEXT_COLOR = COLORS.textMuted;
const WICK_COLOR = '#A7B1C2';
const BULLISH_COLOR = COLORS.green;
const BEARISH_COLOR = COLORS.red;

const LEFT_PADDING = 50;
const RIGHT_PADDING = 48;
const TOP_PADDING = 12;
const BOTTOM_PADDING = 8;
const CHART_HEIGHT = 320;
const MAX_VISIBLE = 80;
const CANDLE_BODY_RATIO = 0.45;
const CANDLE_WIDTH_MAX = 10;

function formatPrice(value: number): string {
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
}


function normaliseCandles(raw: Candle[]): Candle[] {
  if (raw.length === 0) return [];
  const sorted = [...raw].sort((a, b) => a.timestamp - b.timestamp);
  const out: Candle[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    const prevClose = out.length > 0 ? out[out.length - 1].close : c.open;
    const open = prevClose;
    const close = c.close;
    const high = Math.max(c.high, open, close);
    const low = Math.min(c.low, open, close);
    out.push({ ...c, open, high, low, close });
  }
  return out;
}

interface Props {
  candles: Candle[];
  livePrice?: number | null;
}

export default function CandlestickChart({ candles, livePrice }: Props) {
  const visible = useMemo(() => {
    const norm = normaliseCandles(candles);
    return norm.slice(-MAX_VISIBLE);
  }, [candles]);

  const range = useMemo(() => {
    if (visible.length === 0) return { min: 0, max: 1 };
    let lowest = Infinity;
    let highest = -Infinity;
    for (const c of visible) {
      if (c.low < lowest) lowest = c.low;
      if (c.high > highest) highest = c.high;
    }
    // Include livePrice in range so the line is always visible
    if (typeof livePrice === 'number' && Number.isFinite(livePrice)) {
      if (livePrice < lowest) lowest = livePrice;
      if (livePrice > highest) highest = livePrice;
    }
    if (lowest === highest) { lowest -= 1; highest += 1; }
    const pad = (highest - lowest) * 0.06;
    return { min: lowest - pad, max: highest + pad };
  }, [visible, livePrice]);

  const count = visible.length || 1;
  const plotWidth = 600 - LEFT_PADDING - RIGHT_PADDING;
  const spacing = plotWidth / count;
  const candleWidth = Math.min(Math.max(spacing * CANDLE_BODY_RATIO, 2), CANDLE_WIDTH_MAX);

  const getY = (value: number) => {
    const plotH = CHART_HEIGHT - TOP_PADDING - BOTTOM_PADDING;
    return TOP_PADDING + ((range.max - value) / (range.max - range.min)) * plotH;
  };

  const formatValue = (v: number) => formatPrice(v);

  const gridValues = useMemo(() => {
    const vals: number[] = [];
    const step = (range.max - range.min) / 5;
    for (let i = 0; i <= 5; i++) {
      vals.push(range.min + step * i);
    }
    return vals;
  }, [range]);

  const priceLineY = livePrice != null ? getY(livePrice) : null;

  return (
    <View style={{ width: '100%', backgroundColor: CHART_BG }}>
      <View style={{ width: '100%', backgroundColor: CHART_BG, overflow: 'hidden' }}>
        <Svg
          width="100%"
          height={CHART_HEIGHT}
          viewBox={`0 0 600 ${CHART_HEIGHT}`}
          preserveAspectRatio="none"
        >
          <Rect x={0} y={0} width={600} height={CHART_HEIGHT} fill={CHART_BG} />

          {/* Grid */}
          {gridValues.map((value) => {
            const y = getY(value);
            return (
              <G key={value}>
                <Line x1={LEFT_PADDING} y1={y} x2={600 - RIGHT_PADDING} y2={y} stroke={GRID_COLOR} strokeWidth={0.5} />
                <SvgText x={600 - RIGHT_PADDING + 8} y={y + 4} fill={TEXT_COLOR} fontSize={9} fontWeight="500" textAnchor="start">
                  {formatValue(value)}
                </SvgText>
              </G>
            );
          })}

          {/* Candles */}
          {visible.map((candle, index) => {
            const centerX = LEFT_PADDING + index * spacing + spacing / 2;
            const openY = getY(candle.open);
            const closeY = getY(candle.close);
            const highY = getY(candle.high);
            const lowY = getY(candle.low);
            const bullish = candle.close >= candle.open;
            const color = bullish ? BULLISH_COLOR : BEARISH_COLOR;
            const bodyTop = Math.min(openY, closeY);
            const bodyHeight = Math.max(Math.abs(closeY - openY), 2);

            return (
              <G key={`${candle.timestamp}-${index}`}>
                <Line x1={centerX} y1={highY} x2={centerX} y2={lowY} stroke={WICK_COLOR} strokeWidth={1} />
                <Rect x={centerX - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} rx={1} fill={color} />
              </G>
            );
          })}

          {/* Live price dashed line + pill */}
          {priceLineY != null && livePrice != null && (
            <G>
              {/* Dashed horizontal line across chart */}
              <Line
                x1={LEFT_PADDING}
                y1={priceLineY}
                x2={600 - RIGHT_PADDING}
                y2={priceLineY}
                stroke="#FACC15"
                strokeWidth={1.2}
                strokeDasharray="6 3"
              />
              {/* Price pill on right edge */}
              <Rect
                x={600 - RIGHT_PADDING - 2}
                y={priceLineY - 10}
                width={46}
                height={20}
                rx={4}
                fill="#FACC15"
              />
              <SvgText
                x={600 - RIGHT_PADDING + 21}
                y={priceLineY + 4}
                fill="#000000"
                fontSize={9}
                fontWeight="700"
                textAnchor="middle"
              >
                {formatPrice(livePrice)}
              </SvgText>
            </G>
          )}
        </Svg>
      </View>
    </View>
  );
}
