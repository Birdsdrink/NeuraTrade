import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import COLORS from '../../../theme/colors';
import AnimatedGauge from './AnimatedGauge';
import SectionCard from './SectionCard';
import KVRow from './KVRow';
import InsightCard from './InsightCard';
import Accordion from './Accordion';
import { AiAnalysis } from '../mockAiAnalysis';

// Dynamic value coloring for bullish/bearish-ish strings
const semanticColor = (value: string): string | undefined => {
  const v = value.toLowerCase();
  if (v.includes('bullish') || v.includes('buy')) return COLORS.green;
  if (v.includes('bearish') || v.includes('sell')) return COLORS.red;
  if (v.includes('overextended') || v.includes('caution')) return COLORS.yellow;
  return undefined;
};

const LEVEL_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  daily: 'Daily',
  h4: '4H Struct',
  h1: '1H Struct',
};

interface AiDashboardProps {
  data: AiAnalysis;
  warnings?: string[];
  meta?: { symbol?: string; timeframe?: string; currentPrice?: number | null } | null;
}

export default function AiDashboard({ data, warnings, meta }: AiDashboardProps) {
  const metaLine = meta?.symbol
    ? `${meta.symbol}${meta.timeframe ? ` · ${meta.timeframe}` : ''}${
        meta.currentPrice != null ? ` · ${meta.currentPrice}` : ''
      }`
    : null;

  return (
    <View>
      {/* ── Confidence gauge + status ─────────────────────────────────── */}
      <View style={styles.gaugeCard}>
        {metaLine ? <Text style={styles.metaLine}>{metaLine}</Text> : null}
        <AnimatedGauge score={data.score} />
        <Text style={styles.confidenceCaption}>AI CONFIDENCE SCORE</Text>
        <View
          style={[
            styles.statusPill,
            { borderColor: semanticColor(data.status) ?? COLORS.yellow },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              { color: semanticColor(data.status) ?? COLORS.yellow },
            ]}
          >
            {data.status}
          </Text>
        </View>
        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <Text style={styles.badgeLabel}>Risk</Text>
            <Text style={styles.badgeValue}>{data.riskLevel}</Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeLabel}>Conf</Text>
            <Text style={styles.badgeValue}>{data.confidenceLevel}</Text>
          </View>
        </View>
      </View>

      {/* ── Key insights 2x2 grid ─────────────────────────────────────── */}
      <View style={styles.gridWrap}>
        <InsightCard icon="trending-up" label="TREND" value={data.insights.trend} />
        <InsightCard icon="speedometer" label="MOMENTUM" value={data.insights.momentum} />
        <InsightCard icon="waves" label="LIQ. BIAS" value={data.insights.liq_bias} />
        <InsightCard icon="thought-bubble-outline" label="SENTIMENT" value={data.insights.sentiment} />
      </View>

      {/* ── Trade Setup (when to buy / sell / exit + risk) ───────────── */}
      <SectionCard title="Trade Setup" icon="swap-vertical-bold">
        <View style={styles.actionRow}>
          <Text style={styles.actionLabel}>ACTION</Text>
          <Text style={[styles.actionValue, { color: semanticColor(data.tradePlan.action) ?? COLORS.yellow }]}>
            {data.tradePlan.action}
          </Text>
        </View>
        <View style={styles.actionDivider} />
        <KVRow label="When to Buy" value={data.tradePlan.whenToBuy} valueColor={COLORS.green} />
        <KVRow label="When to Sell" value={data.tradePlan.whenToSell} valueColor={COLORS.red} />
        <KVRow label="When to Exit" value={data.tradePlan.whenToExit} valueColor={COLORS.yellow} />
        <View style={styles.actionDivider} />
        <KVRow label="Stop Loss" value={data.tradePlan.stopLoss} valueColor={COLORS.red} />
        <KVRow label="RR Ratio" value={data.tradePlan.rrRatio} />
        <KVRow label="Position Size" value={data.tradePlan.positionSize} />
      </SectionCard>

      {/* ── Multi-Timeframe ───────────────────────────────────────────── */}
      <SectionCard title="Multi-Timeframe" icon="chart-multiple">
        {(Object.keys(data.multiTimeframe) as Array<keyof typeof data.multiTimeframe>).map((k) => (
          <KVRow
            key={k}
            label={LEVEL_LABELS[k] ?? k}
            value={data.multiTimeframe[k]}
            valueColor={semanticColor(data.multiTimeframe[k])}
          />
        ))}
      </SectionCard>

      {/* ── Detailed breakdown accordions ─────────────────────────────── */}
      <Text style={styles.sectionHeading}>DETAILED BREAKDOWN</Text>
      {data.breakdown.map((item) => (
        <Accordion key={item.title} title={item.title} content={item.content} />
      ))}

      {/* ── Warnings ──────────────────────────────────────────────────── */}
      {(warnings ?? []).length > 0 && (
        <View style={styles.warnCard}>
          {warnings!.map((w, i) => (
            <Text key={i} style={styles.warnText}>⚠ {w}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  gaugeCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.subtleBorder,
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  confidenceCaption: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 10,
  },
  statusPill: {
    marginTop: 12,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 9,
    backgroundColor: COLORS.elevatedCard,
  },
  statusText: {
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.elevatedCard,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: COLORS.subtleBorder,
  },
  badgeLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  badgeValue: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  paragraph: {
    color: COLORS.textSecondary,
    fontSize: 13.5,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  actionLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  actionValue: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  actionDivider: {
    borderTopWidth: 1,
    borderTopColor: COLORS.subtleBorder,
    marginVertical: 10,
  },
  metaLine: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  warnCard: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
    padding: 12,
    marginTop: 4,
    marginBottom: 20,
  },
  warnText: {
    color: COLORS.red,
    fontSize: 12,
    lineHeight: 17,
  },
  sectionHeading: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 12,
    marginBottom: 10,
  },
});
