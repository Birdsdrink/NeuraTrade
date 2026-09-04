import React, { useState, useMemo, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, TextInput } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import MarketCard from '../../components/MarketCard';
import { useMarkets } from '../../features/markets/hooks/useMarkets';
import AppHeader from '../../components/AppHeader';
import COLORS from '../../theme/colors';
import { Market } from '../../domain/entities/Market';

/** Strip Deriv prefixes for search matching. */
function searchable(m: Market): string {
  return [m.symbol, m.displayName ?? '', m.market ?? ''].join(' ').toLowerCase();
}

const CATEGORIES = ['All', 'Forex', 'Crypto', 'Commodities', 'Indices'] as const;

function categorise(m: Market): string {
  const mkt = (m.market ?? '').toLowerCase();
  if (mkt.includes('crypto')) return 'Crypto';
  if (mkt.includes('commodit') || mkt.includes('metal') || mkt.includes('gold') || mkt.includes('silver')) return 'Commodities';
  if (mkt.includes('index') || mkt.includes('stock') || mkt.includes('wall street') || mkt.includes('nasdaq') || mkt.includes('dax') || mkt.includes('nikkei') || mkt.includes('ftse') || mkt.includes('dow') || mkt.includes('s&p') || mkt.includes('russell') || mkt.includes('us dollar')) return 'Indices';
  return 'Forex';
}

const TOP_PAIRS = ['frxEURUSD', 'frxGBPUSD', 'frxUSDJPY', 'frxAUDUSD', 'cryBTCUSD', 'Gold'];

export default function MarketsScreen({ navigation, onMarketSelect }: {
  navigation: (screen: 'Markets' | 'MarketDetail' | 'AIAnalysis' | 'Watchlist' | 'FundamentalAnalysis' | 'Settings') => void;
  onMarketSelect: (market: Market) => void;
}) {
  const { data: markets = [], isLoading, isError, refetch } = useMarkets();
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');

  const filtered = useMemo(() => {
    let list = markets;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((m) => searchable(m).includes(q));
    }
    if (activeCategory !== 'All') {
      list = list.filter((m) => categorise(m) === activeCategory);
    }
    return list;
  }, [markets, query, activeCategory]);

  // Group by category (only when "All" is selected and no search)
  const grouped = useMemo(() => {
    if (activeCategory !== 'All' || query.trim()) return null;
    const groups: Record<string, Market[]> = {};
    for (const m of filtered) {
      const cat = categorise(m);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(m);
    }
    return groups;
  }, [filtered, activeCategory, query]);

  // Quick-access top pairs
  const topPairs = useMemo(() => {
    return TOP_PAIRS
      .map((sym) => markets.find((m) => m.symbol === sym))
      .filter(Boolean) as Market[];
  }, [markets]);

  // Count per category
  const catCounts = useMemo(() => {
    const counts: Record<string, number> = { All: markets.length };
    for (const m of markets) {
      const cat = categorise(m);
      counts[cat] = (counts[cat] || 0) + 1;
    }
    return counts;
  }, [markets]);

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
      <AppHeader title="Markets" subtitle="Live market data" />

      {/* ── Search ─────────────────────────────────────────────────── */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.cardBg,
        borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16,
        borderWidth: 1, borderColor: COLORS.subtleBorder,
      }}>
        <MaterialCommunityIcons name="magnify" size={18} color={COLORS.textMuted} style={{ marginRight: 8 }} />
        <TextInput
          placeholder="Search instruments…"
          placeholderTextColor={COLORS.textMuted}
          value={query}
          onChangeText={setQuery}
          style={{ flex: 1, color: COLORS.textPrimary, fontSize: 14, padding: 0 }}
          autoCorrect={false}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')}>
            <MaterialCommunityIcons name="close-circle" size={16} color={COLORS.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Quick Access (top pairs) ───────────────────────────────── */}
      {topPairs.length > 0 && !query.trim() && (
        <View style={{ marginBottom: 20 }}>
          <Text style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 10 }}>QUICK ACCESS</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {topPairs.map((item) => (
              <View key={item.symbol} style={{ marginRight: 8 }}>
                <MarketCard item={item} compact onPress={() => onMarketSelect(item)} />
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* ── Category Tabs ──────────────────────────────────────────── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
        {CATEGORIES.map((cat) => {
          const active = activeCategory === cat;
          const count = catCounts[cat] ?? 0;
          return (
            <TouchableOpacity
              key={cat}
              onPress={() => setActiveCategory(cat)}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
                backgroundColor: active ? COLORS.purple : COLORS.cardBg,
                marginRight: 8, borderWidth: 1,
                borderColor: active ? COLORS.purple : COLORS.subtleBorder,
              }}
            >
              <Text style={{
                fontSize: 12, fontWeight: '700',
                color: active ? COLORS.textPrimary : COLORS.textSecondary,
              }}>
                {cat}
              </Text>
              <View style={{
                marginLeft: 6, backgroundColor: active ? 'rgba(255,255,255,0.2)' : COLORS.subtleBorder,
                borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
              }}>
                <Text style={{ fontSize: 10, fontWeight: '700', color: active ? COLORS.textPrimary : COLORS.textMuted }}>
                  {count}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Loading / Error ────────────────────────────────────────── */}
      {isLoading && (
        <View style={{ padding: 30, alignItems: 'center' }}>
          <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>Loading market data…</Text>
        </View>
      )}

      {isError && (
        <View style={{ padding: 30, alignItems: 'center' }}>
          <MaterialCommunityIcons name="cloud-off-outline" size={36} color={COLORS.textMuted} />
          <Text style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 8, textAlign: 'center' }}>Could not reach the backend.</Text>
          <TouchableOpacity onPress={() => refetch()} style={{ marginTop: 8, backgroundColor: COLORS.cardBg, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}>
            <Text style={{ color: COLORS.purple, fontWeight: '700', fontSize: 13 }}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Empty State ────────────────────────────────────────────── */}
      {!isLoading && !isError && filtered.length === 0 && (
        <View style={{ padding: 30, alignItems: 'center' }}>
          <MaterialCommunityIcons name="magnify-close" size={32} color={COLORS.textMuted} />
          <Text style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 8, textAlign: 'center' }}>
            {query.trim() ? `No instruments matching "${query.trim()}"` : 'No instruments available.'}
          </Text>
        </View>
      )}

      {/* ── Categorized Sections (when viewing All with no search) ── */}
      {!isLoading && !isError && grouped && (
        Object.entries(grouped).map(([category, items]) => (
          <View key={category} style={{ marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: COLORS.purple, marginRight: 8 }} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: COLORS.textPrimary, letterSpacing: 0.3 }}>{category.toUpperCase()}</Text>
              </View>
              <View style={{ backgroundColor: COLORS.cardBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: COLORS.textMuted }}>{items.length}</Text>
              </View>
            </View>
            {items.slice(0, 5).map((item) => (
              <MarketCard key={item.symbol} item={item} onPress={() => onMarketSelect(item)} />
            ))}
            {items.length > 5 && (
              <TouchableOpacity
                onPress={() => {
                  setActiveCategory(category as any);
                }}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  paddingVertical: 10, backgroundColor: COLORS.cardBg, borderRadius: 12,
                  borderWidth: 1, borderColor: COLORS.subtleBorder, marginTop: 4,
                }}
              >
                <Text style={{ color: COLORS.purple, fontSize: 12, fontWeight: '700' }}>
                  View all {items.length} {category.toLowerCase()}
                </Text>
                <MaterialCommunityIcons name="chevron-right" size={16} color={COLORS.purple} style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            )}
          </View>
        ))
      )}

      {/* ── Filtered list (when category or search is active) ──────── */}
      {!isLoading && !isError && !grouped && filtered.length > 0 && (
        <>
          <Text style={{ color: COLORS.textMuted, fontSize: 11, fontWeight: '700', marginBottom: 10, letterSpacing: 0.5 }}>
            {query.trim() ? `${filtered.length} RESULTS` : `${activeCategory.toUpperCase()} · ${filtered.length}`}
          </Text>
          {filtered.map((item) => (
            <MarketCard key={item.symbol} item={item} onPress={() => onMarketSelect(item)} />
          ))}
        </>
      )}
    </ScrollView>
  );
}
