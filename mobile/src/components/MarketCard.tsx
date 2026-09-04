import React from 'react';
import { TouchableOpacity, View, Text } from 'react-native';
import { MaterialCommunityIcons, Ionicons, Feather } from '@expo/vector-icons';
import COLORS from '../theme/colors';
import { Market } from '../domain/entities/Market';

/** Strip Deriv's ``frx`` / ``cry`` prefixes so symbols display as human-readable pairs. */
function displaySymbol(raw: string): string {
  return raw.replace(/^(frx|cry)/i, '');
}

/** Determine the category icon + color from the market name. */
function categoryIcon(market: string | undefined): { name: string; color: string } {
  const m = (market ?? '').toLowerCase();
  if (m.includes('crypto') || m.includes('cryptocurrency')) return { name: 'bitcoin', color: COLORS.yellow };
  if (m.includes('commodit') || m.includes('metal') || m.includes('gold') || m.includes('silver')) return { name: 'gold', color: COLORS.yellow };
  if (m.includes('index') || m.includes('stock') || m.includes('wall street') || m.includes('nasdaq') || m.includes('dax') || m.includes('nikkei') || m.includes('ftse') || m.includes('dow') || m.includes('s&p') || m.includes('russell')) return { name: 'chart-line', color: COLORS.blue };
  return { name: 'currency-usd', color: COLORS.purple };
}

export default function MarketCard({ item, onPress, compact }: { item: Market; onPress?: () => void; compact?: boolean }) {
  const label = item.displayName || displaySymbol(item.symbol);
  const icon = categoryIcon(item.market);
  const isLive = item.isOpen !== false;

  if (compact) {
    // Compact mode: used in horizontal quick-access rows
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.82} style={{
        backgroundColor: COLORS.cardBg, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16,
        borderWidth: 1, borderColor: COLORS.subtleBorder, minWidth: 110, alignItems: 'center',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: isLive ? COLORS.green : COLORS.textMuted, marginRight: 4 }} />
          <Text style={{ fontSize: 10, fontWeight: '700', color: isLive ? COLORS.green : COLORS.textMuted, letterSpacing: 0.5 }}>
            {isLive ? 'LIVE' : 'CLOSED'}
          </Text>
        </View>
        <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.textPrimary, textAlign: 'center' }}>{label}</Text>
        <Text style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 2, textAlign: 'center' }}>{displaySymbol(item.symbol)}</Text>
      </TouchableOpacity>
    );
  }

  // Full mode: used in category lists
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.82} style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      backgroundColor: COLORS.cardBg, borderRadius: 16, padding: 14, marginBottom: 8,
      borderWidth: 1, borderColor: COLORS.subtleBorder,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
        <View style={{
          width: 40, height: 40, borderRadius: 12,
          backgroundColor: icon.color + '18',
          justifyContent: 'center', alignItems: 'center', marginRight: 12,
        }}>
          <MaterialCommunityIcons name={icon.name as any} size={18} color={icon.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.textPrimary }}>{label}</Text>
          <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>
            {item.market ?? 'Forex'}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', marginLeft: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isLive ? COLORS.green : COLORS.textMuted, marginRight: 5 }} />
          <Text style={{ fontSize: 11, fontWeight: '700', color: isLive ? COLORS.green : COLORS.textMuted }}>
            {isLive ? 'Live' : 'Closed'}
          </Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={16} color={COLORS.textMuted} style={{ marginTop: 2 }} />
      </View>
    </TouchableOpacity>
  );
}
