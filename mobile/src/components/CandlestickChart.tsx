import React, { memo, useCallback, useMemo, useState } from 'react';
import { View, Text, LayoutChangeEvent } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';
import { Candle } from '../domain/entities/Candle';
import COLORS from '../theme/colors';

/**
 * Candlestick chart for the live market view.
 *
 * Rendering notes (these are the things that made the previous version look
 * cluttered rather than a data problem):
 *
 *  - It renders at the measured pixel width. The old version drew into a
 *    600-unit viewBox stretched to the screen with `preserveAspectRatio="none"`,
 *    which squashed 80 bars into ~2px bodies with non-uniform stroke widths.
 *  - The number of visible bars is derived from the measured width and a minimum
 *    comfortable pitch, so a phone shows a readable count instead of a fence.
 *  - The price scale snaps outward to round steps, so a tick that moves the price
 *    a fraction of a pip cannot rescale (and visibly jitter) the whole chart.
 *  - Bars are memoised and receive stable price/time scales, so a new tick only
 *    re-renders the single forming candle.
 */

const CHART_HEIGHT = 300;
const PRICE_SCALE_WIDTH = 58;
const TIME_AXIS_HEIGHT = 18;
const TOP_PADDING = 8;
const RIGHT_GUTTER = 4;

// Minimum distance between candle centres. Below this the bodies visually merge
// into a solid block, which is what "crammed candles" looks like.
const MIN_CANDLE_PITCH = 7;
const MAX_VISIBLE_CANDLES = 60;
const MIN_VISIBLE_CANDLES = 12;

const BODY_RATIO = 0.62;
const MIN_BODY_WIDTH = 1.5;
const MAX_BODY_WIDTH = 11;

const CHART_BG = COLORS.bgPrimary;
const GRID_COLOR = COLORS.subtleBorder;
const TEXT_COLOR = COLORS.textMuted;
const WICK_COLOR = '#A7B1C2';
const BULLISH_COLOR = COLORS.green;
const BEARISH_COLOR = COLORS.red;
const LIVE_LINE_COLOR = COLORS.yellow;

function formatPrice(value: number): string {
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(5);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Drop malformed bars, collapse duplicate timestamps (keeping the latest value
 * for each) and guarantee ascending order. Bars that need no repair keep their
 * original object identity so the memoised candle components can skip them.
 */
function sanitiseCandles(raw: Candle[]): Candle[] {
  const byTimestamp = new Map<number, Candle>();
  for (const candle of raw) {
    if (
      !Number.isFinite(candle?.timestamp)
      || !Number.isFinite(candle?.open)
      || !Number.isFinite(candle?.high)
      || !Number.isFinite(candle?.low)
      || !Number.isFinite(candle?.close)
    ) {
      continue;
    }
    // A bar must contain its own body: no fake values are invented, only the
    // impossible ones are corrected.
    const high = Math.max(candle.high, candle.open, candle.close);
    const low = Math.min(candle.low, candle.open, candle.close);
    byTimestamp.set(
      candle.timestamp,
      high === candle.high && low === candle.low ? candle : { ...candle, high, low },
    );
  }
  return [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/** A round step (1/2/2.5/5 x 10^n) near `span / divisions`. */
function niceStep(span: number, divisions: number): number {
  const rough = span / Math.max(divisions, 1);
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalised = rough / magnitude;
  const nice = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return nice * magnitude;
}

function formatAxisTime(timestamp: number, timeframeSeconds: number): string {
  // `timestamp` is unix ms; Date renders it in the device's own timezone, so the
  // axis always matches the clock the user is looking at.
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  if (timeframeSeconds >= 86400) {
    return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  }
  if (timeframeSeconds >= 3600) {
    return date.toLocaleString(undefined, {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

interface BarProps {
  x: number;
  bodyWidth: number;
  candle: Candle;
  toY: (value: number) => number;
}

const CandleBar = memo(function CandleBar({ x, bodyWidth, candle, toY }: BarProps) {
  const openY = toY(candle.open);
  const closeY = toY(candle.close);
  const bullish = candle.close >= candle.open;
  const color = bullish ? BULLISH_COLOR : BEARISH_COLOR;
  const bodyTop = Math.min(openY, closeY);
  // A doji still needs a visible body, otherwise the bar flickers in and out.
  const bodyHeight = Math.max(Math.abs(closeY - openY), 1);

  return (
    <G>
      <Line x1={x} y1={toY(candle.high)} x2={x} y2={toY(candle.low)} stroke={WICK_COLOR} strokeWidth={1} />
      <Rect
        x={x - bodyWidth / 2}
        y={bodyTop}
        width={bodyWidth}
        height={bodyHeight}
        rx={bodyWidth > 3 ? 1 : 0}
        fill={color}
      />
    </G>
  );
});

interface Props {
  candles: Candle[];
  livePrice?: number | null;
  timeframeSeconds?: number;
}

export default function CandlestickChart({ candles, livePrice, timeframeSeconds = 60 }: Props) {
  const [width, setWidth] = useState(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (Math.abs(current - next) > 0.5 ? next : current));
  }, []);

  const ordered = useMemo(() => sanitiseCandles(candles), [candles]);

  const plotWidth = Math.max(width - PRICE_SCALE_WIDTH - RIGHT_GUTTER, 1);
  const plotHeight = CHART_HEIGHT - TOP_PADDING - TIME_AXIS_HEIGHT;

  // How many bars actually fit at a readable pitch — not a fixed count.
  const maxVisible = clamp(
    Math.floor(plotWidth / MIN_CANDLE_PITCH),
    MIN_VISIBLE_CANDLES,
    MAX_VISIBLE_CANDLES,
  );

  // Keep the newest bar flush against the right edge.
  const visible = useMemo(
    () => (ordered.length > maxVisible ? ordered.slice(-maxVisible) : ordered),
    [ordered, maxVisible],
  );

  const live = typeof livePrice === 'number' && Number.isFinite(livePrice) ? livePrice : null;

  const scale = useMemo(() => {
    if (visible.length === 0) return { min: 0, max: 1, ticks: [] as number[] };

    let lowest = Infinity;
    let highest = -Infinity;
    for (const candle of visible) {
      if (candle.low < lowest) lowest = candle.low;
      if (candle.high > highest) highest = candle.high;
    }
    if (live !== null) {
      if (live < lowest) lowest = live;
      if (live > highest) highest = live;
    }
    if (lowest === highest) {
      lowest -= 1;
      highest += 1;
    }

    const pad = (highest - lowest) * 0.08;
    const step = niceStep(highest - lowest + pad * 2, 5);
    // Snapping OUTWARD to round steps means small price moves stay inside the
    // existing band and leave the scale untouched — no per-tick rescale jitter.
    const min = Math.floor((lowest - pad) / step) * step;
    const max = Math.ceil((highest + pad) / step) * step;
    const divisions = Math.max(Math.round((max - min) / step), 1);
    const ticks = Array.from({ length: divisions + 1 }, (_, i) => min + step * i);
    return { min, max, ticks };
  }, [visible, live]);

  const range = Math.max(scale.max - scale.min, Number.EPSILON);
  const priceAxisX = Math.max(width - PRICE_SCALE_WIDTH, 0);

  // Stable while the scale is unchanged, so memoised bars are reused.
  const toY = useCallback(
    (value: number) => TOP_PADDING + ((scale.max - value) / range) * plotHeight,
    [scale.max, range, plotHeight],
  );

  const pitch = plotWidth / Math.max(visible.length, 1);
  const bodyWidth = clamp(pitch * BODY_RATIO, MIN_BODY_WIDTH, MAX_BODY_WIDTH);
  const liveY = live !== null ? toY(live) : null;

  const timeLabels = useMemo(() => {
    if (visible.length === 0) return [];
    const wanted = Math.min(4, visible.length);
    const every = Math.max(Math.floor(visible.length / wanted), 1);
    const labels: { x: number; text: string }[] = [];
    for (let i = visible.length - 1; i >= 0; i -= every) {
      labels.push({
        x: i * pitch + pitch / 2,
        text: formatAxisTime(visible[i].timestamp, timeframeSeconds),
      });
    }
    return labels;
  }, [visible, pitch, timeframeSeconds]);

  return (
    <View style={{ width: '100%', backgroundColor: CHART_BG, paddingVertical: 6 }} onLayout={onLayout}>
      {width > 0 && (
        <Svg width={width} height={CHART_HEIGHT}>
          {/* Price grid + right-hand price scale */}
          {scale.ticks.map((value) => {
            const y = toY(value);
            if (y < TOP_PADDING - 0.5 || y > TOP_PADDING + plotHeight + 0.5) return null;
            return (
              <G key={`grid-${value}`}>
                <Line
                  x1={0}
                  y1={y}
                  x2={plotWidth}
                  y2={y}
                  stroke={GRID_COLOR}
                  strokeWidth={0.5}
                />
                <SvgText
                  x={priceAxisX + 6}
                  y={y + 3}
                  fill={TEXT_COLOR}
                  fontSize={9}
                  fontWeight="500"
                  textAnchor="start"
                >
                  {formatPrice(value)}
                </SvgText>
              </G>
            );
          })}

          {/* Candles — memoised individually so a tick redraws only the last bar */}
          {visible.map((candle, index) => (
            <CandleBar
              key={candle.timestamp}
              x={index * pitch + pitch / 2}
              bodyWidth={bodyWidth}
              candle={candle}
              toY={toY}
            />
          ))}

          {/* Current price line + right-edge pill */}
          {liveY !== null && live !== null && (
            <G>
              <Line
                x1={0}
                y1={liveY}
                x2={plotWidth}
                y2={liveY}
                stroke={LIVE_LINE_COLOR}
                strokeWidth={1}
                strokeDasharray="5 3"
              />
              <Rect
                x={priceAxisX}
                y={liveY - 9}
                width={PRICE_SCALE_WIDTH - 2}
                height={18}
                rx={4}
                fill={LIVE_LINE_COLOR}
              />
              <SvgText
                x={priceAxisX + (PRICE_SCALE_WIDTH - 2) / 2}
                y={liveY + 4}
                fill="#000000"
                fontSize={9.5}
                fontWeight="700"
                textAnchor="middle"
              >
                {formatPrice(live)}
              </SvgText>
            </G>
          )}

          {/* Time axis (device timezone) */}
          {timeLabels.map((label) => (
            <SvgText
              key={`time-${label.x}-${label.text}`}
              x={label.x}
              y={CHART_HEIGHT - 5}
              fill={TEXT_COLOR}
              fontSize={9}
              textAnchor="middle"
            >
              {label.text}
            </SvgText>
          ))}
        </Svg>
      )}

      {visible.length === 0 && (
        <View style={{ height: CHART_HEIGHT, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: TEXT_COLOR, fontSize: 12 }}>
            Waiting for market data…
          </Text>
        </View>
      )}
    </View>
  );
}
