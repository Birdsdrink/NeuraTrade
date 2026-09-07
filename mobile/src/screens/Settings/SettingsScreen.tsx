import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, Switch } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import COLORS from '../../theme/colors';
import { useSettings } from '../../hooks/useSettings';
import AppHeader from '../../components/AppHeader';

const TIMEFRAMES = ['5m', '15m', '30m', '1H', '4H', '1D'];

export default function SettingsScreen({ navigation }: {
  navigation: (screen: 'Markets' | 'MarketDetail' | 'AIAnalysis' | 'Watchlist' | 'FundamentalAnalysis' | 'Settings') => void;
}) {
  const { settings, update } = useSettings();

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
      <AppHeader title="Settings" subtitle="Settings" />

      {/* ── Trading Defaults ──────────────────────────────────────── */}
      <SectionHeader icon="chart-line" title="TRADING DEFAULTS" />

      <Row>
        <RowLeft icon="time-outline" label="Default Timeframe" />
        <View style={{ flexDirection: 'row' }}>
          {TIMEFRAMES.map((tf) => (
            <TouchableOpacity
              key={tf}
              onPress={() => update('defaultTimeframe', tf)}
              style={{
                paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginLeft: 3,
                backgroundColor: settings.defaultTimeframe === tf ? COLORS.purple : 'transparent',
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: settings.defaultTimeframe === tf ? COLORS.textPrimary : COLORS.textMuted }}>{tf}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Row>

      <Row last>
        <RowLeft icon="layers-outline" label="Candle Count" />
        <View style={{ flexDirection: 'row' }}>
          {[50, 100, 200].map((n) => (
            <TouchableOpacity
              key={n}
              onPress={() => update('defaultCandleCount', n)}
              style={{
                paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginLeft: 4,
                backgroundColor: settings.defaultCandleCount === n ? COLORS.purple : 'transparent',
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: settings.defaultCandleCount === n ? COLORS.textPrimary : COLORS.textMuted }}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Row>

      {/* ── Data Refresh ──────────────────────────────────────────── */}
      <SectionHeader icon="sync" title="DATA" />

      <Row last>
        <RowLeft icon="sync-outline" label="Refresh Interval" />
        <View style={{ flexDirection: 'row' }}>
          {[10, 30, 60].map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => update('refreshInterval', s)}
              style={{
                paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginLeft: 4,
                backgroundColor: settings.refreshInterval === s ? COLORS.purple : 'transparent',
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: settings.refreshInterval === s ? COLORS.textPrimary : COLORS.textMuted }}>{s}s</Text>
            </TouchableOpacity>
          ))}
        </View>
      </Row>

      {/* ── AI ────────────────────────────────────────────────────── */}
      <SectionHeader icon="brain" title="AI" />

      <Row last>
        <RowLeft icon="flash-outline" label="Auto-run on open" />
        <Switch
          value={settings.autoAnalysis}
          onValueChange={(v) => update('autoAnalysis', v)}
          trackColor={{ false: COLORS.subtleBorder, true: COLORS.purple + '60' }}
          thumbColor={settings.autoAnalysis ? COLORS.purple : COLORS.textMuted}
        />
      </Row>

      {/* ── About ─────────────────────────────────────────────────── */}
      <SectionHeader icon="information" title="ABOUT" />

      <Row>
        <RowLeft icon="code-slash-outline" label="Version" />
        <Text style={{ fontSize: 13, color: COLORS.textMuted }}>2.5.0-beta</Text>
      </Row>

      <Row>
        <RowLeft icon="business-outline" label="Developer" />
        <Text style={{ fontSize: 13, color: COLORS.textPrimary, fontWeight: '600' }}>Datalink International</Text>
      </Row>

      <Row>
        <RowLeft icon="mail-outline" label="Email" />
        <Text style={{ fontSize: 12, color: COLORS.blue }}>francisshiri@gmail.com</Text>
      </Row>

      <Row last>
        <RowLeft icon="logo-whatsapp" label="WhatsApp" />
        <Text style={{ fontSize: 12, color: COLORS.green }}>+263776442699</Text>
      </Row>
    </ScrollView>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, marginTop: 8 }}>
      <MaterialCommunityIcons name={icon as any} size={14} color={COLORS.purple} style={{ marginRight: 8 }} />
      <Text style={{ fontSize: 11, color: COLORS.textMuted, fontWeight: '700', letterSpacing: 0.8 }}>{title}</Text>
    </View>
  );
}

function Row({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      backgroundColor: COLORS.cardBg, padding: 14, borderRadius: last ? 14 : 14,
      marginBottom: last ? 12 : 2, borderWidth: 1, borderColor: COLORS.subtleBorder,
    }}>
      {children}
    </View>
  );
}

function RowLeft({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Ionicons name={icon as any} size={18} color={COLORS.textSecondary} style={{ marginRight: 12 }} />
      <Text style={{ fontSize: 14, color: COLORS.textPrimary }}>{label}</Text>
    </View>
  );
}
