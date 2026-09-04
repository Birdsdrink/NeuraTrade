import React, { useState, useCallback } from 'react';
import {
  ScrollView, View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import COLORS from '../../theme/colors';
import AppHeader from '../../components/AppHeader';
import { useMarkets } from '../../features/markets/hooks/useMarkets';
import { Market } from '../../domain/entities/Market';
import { aiClient } from '../../services/api/apiClient';
import { useSettings } from '../../hooks/useSettings';

type NewsImpact = {
  headline: string;
  impact: 'bullish' | 'bearish' | 'neutral';
  relevance: number;
};

type FundResult = {
  instrument?: string;
  sentiment?: string;
  sentiment_score?: number;
  confidence?: number;
  recommendation?: string;
  bias?: string;
  key_themes?: string[];
  news_impact?: NewsImpact[];
  economic_factors?: string[];
  central_bank_outlook?: string;
  geopolitical_risk?: string;
  analysis?: string;
  reasons?: string[];
  warnings?: string[];
  news_count?: number;
};

export default function FundamentalAnalysisScreen({
  navigation,
  preselectedMarket,
}: {
  navigation: (screen: 'Markets' | 'MarketDetail' | 'AIAnalysis' | 'Watchlist' | 'FundamentalAnalysis' | 'Settings') => void;
  preselectedMarket?: Market | null;
}) {
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(preselectedMarket ?? null);
  const [searchQuery, setSearchQuery] = useState('');
  const [result, setResult] = useState<FundResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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

  // Group markets by category
  const grouped = filteredMarkets.reduce<Record<string, Market[]>>((acc, m) => {
    const cat = m.market ?? 'Other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(m);
    return acc;
  }, {});

  const sentiment = (result?.sentiment ?? '').toLowerCase();
  const sentimentColor =
    sentiment === 'bullish' ? COLORS.green :
    sentiment === 'bearish' ? COLORS.red : COLORS.yellow;

  const rec = (result?.recommendation ?? '').toUpperCase();
  const recColor =
    rec === 'BUY' ? COLORS.green :
    rec === 'SELL' ? COLORS.red : COLORS.yellow;

  const runAnalysis = useCallback(async (market: Market) => {
    setSelectedMarket(market);
    setLoading(true);
    setResult(null);
    try {
      const { data } = await aiClient.post('/fundamental-analysis', {
        symbol: market.symbol,
        display_name: market.displayName ?? market.symbol,
      });
      setResult(data);
    } catch (e: any) {
      setResult({
        instrument: market.displayName ?? market.symbol,
        sentiment: 'neutral',
        confidence: 0,
        recommendation: 'WAIT',
        analysis: e?.message ?? 'Analysis request failed.',
        warnings: ['Could not complete fundamental analysis.'],
        news_count: 0,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    if (!selectedMarket) return;
    setRefreshing(true);
    await runAnalysis(selectedMarket);
    setRefreshing(false);
  }, [selectedMarket, runAnalysis]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: 140 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.purple} />}
    >
      <AppHeader title="Fundamental Analysis" subtitle="AI-powered news sentiment" />

      {/* ── Instrument Picker ──────────────────────────────────────── */}
      <View style={{ marginBottom: 16 }}>
        <Text style={{ color: COLORS.textMuted, fontSize: 11, fontWeight: '700', marginBottom: 8, letterSpacing: 0.8 }}>SELECT INSTRUMENT</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.cardBg, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, borderWidth: 1, borderColor: COLORS.subtleBorder }}>
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

        {/* Quick-pick top instruments */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
          {markets.filter((m) => ['frxEURUSD', 'frxGBPUSD', 'frxUSDJPY', 'frxAUDUSD', 'cryBTCUSD', 'Gold'].includes(m.symbol)).map((m) => {
            const active = m.symbol === selectedMarket?.symbol;
            return (
              <TouchableOpacity
                key={m.symbol}
                onPress={() => runAnalysis(m)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
                  backgroundColor: active ? COLORS.purple : COLORS.cardBg,
                  marginRight: 8, borderWidth: 1,
                  borderColor: active ? COLORS.purple : COLORS.subtleBorder,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: active ? COLORS.textPrimary : COLORS.textSecondary }}>
                  {m.displayName ?? m.symbol}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Category Grid ──────────────────────────────────────────── */}
      {!result && !loading && (
        <View>
          {Object.entries(grouped).slice(0, 4).map(([category, items]) => (
            <View key={category} style={{ marginBottom: 12 }}>
              <Text style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>{category.toUpperCase()}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {items.slice(0, 6).map((m) => (
                  <TouchableOpacity
                    key={m.symbol}
                    onPress={() => runAnalysis(m)}
                    style={{
                      backgroundColor: COLORS.cardBg, borderRadius: 10,
                      paddingHorizontal: 12, paddingVertical: 8,
                      borderWidth: 1, borderColor: COLORS.subtleBorder,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '600', color: COLORS.textSecondary }}>
                      {m.displayName ?? m.symbol}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── Loading State ──────────────────────────────────────────── */}
      {loading && (
        <View style={{ alignItems: 'center', paddingVertical: 40 }}>
          <ActivityIndicator size="large" color={COLORS.purple} />
          <Text style={{ color: COLORS.textSecondary, fontSize: 13, marginTop: 12 }}>
            Analysing news for {selectedMarket?.displayName ?? selectedMarket?.symbol}…
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 11, marginTop: 4 }}>
            Fetching headlines and running AI analysis
          </Text>
        </View>
      )}

      {/* ── Results ────────────────────────────────────────────────── */}
      {result && !loading && (
        <>
          {/* Hero Card */}
          <Card style={{ borderColor: sentimentColor + '30' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <Row>
                  <MaterialCommunityIcons name="newspaper-variant-outline" size={18} color={COLORS.purple} />
                  <Text style={{ color: COLORS.purple, fontWeight: '700', fontSize: 11, marginLeft: 6, letterSpacing: 0.6 }}>FUNDAMENTAL ANALYSIS</Text>
                </Row>
                <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 6 }}>
                  {result.instrument} · {result.news_count ?? 0} news articles
                </Text>
              </View>
              <View style={{
                backgroundColor: recColor + '20', borderRadius: 12,
                paddingHorizontal: 16, paddingVertical: 8,
                borderWidth: 1, borderColor: recColor + '40',
              }}>
                <Text style={{ color: recColor, fontSize: 16, fontWeight: '800' }}>{rec || 'WAIT'}</Text>
              </View>
            </View>

            <View style={{ marginTop: 14 }}>
              <Text style={{ fontSize: 26, fontWeight: '800', color: sentimentColor }}>
                {(result.sentiment ?? 'Neutral').charAt(0).toUpperCase() + (result.sentiment ?? 'neutral').slice(1)}
              </Text>
              {result.sentiment_score != null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                  <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: COLORS.subtleBorder, overflow: 'hidden' }}>
                    <View style={{
                      height: '100%', borderRadius: 2,
                      width: `${Math.min(100, Math.abs(result.sentiment_score))}%`,
                      backgroundColor: sentimentColor,
                    }} />
                  </View>
                  <Text style={{ color: COLORS.textMuted, fontSize: 11, marginLeft: 8, minWidth: 36, textAlign: 'right' }}>
                    {result.sentiment_score > 0 ? '+' : ''}{result.sentiment_score}
                  </Text>
                </View>
              )}
            </View>

            <Divider />
            <Text style={{ color: COLORS.textSecondary, fontSize: 13, lineHeight: 20 }}>
              {result.analysis ?? result.bias ?? ''}
            </Text>
            <Divider />
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>Confidence</Text>
              <Text style={{ fontSize: 16, fontWeight: '700', color: sentimentColor }}>{result.confidence ?? 0}%</Text>
            </Row>
          </Card>

          {/* Key Themes */}
          {(result.key_themes?.length ?? 0) > 0 && (
            <Card>
              <Label>KEY THEMES</Label>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 6 }}>
                {(result.key_themes ?? []).map((t, i) => (
                  <View key={i} style={{ backgroundColor: COLORS.purple + '15', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: COLORS.purple + '25' }}>
                    <Text style={{ color: COLORS.purple, fontSize: 11, fontWeight: '600' }}>{t}</Text>
                  </View>
                ))}
              </View>
            </Card>
          )}

          {/* News Impact */}
          {(result.news_impact?.length ?? 0) > 0 && (
            <Card>
              <Label>NEWS IMPACT</Label>
              {(result.news_impact ?? []).slice(0, 5).map((n, i) => {
                const impactColor = n.impact === 'bullish' ? COLORS.green : n.impact === 'bearish' ? COLORS.red : COLORS.yellow;
                return (
                  <View key={i} style={{ marginTop: 10, paddingBottom: 10, borderBottomWidth: i < 4 ? 1 : 0, borderBottomColor: COLORS.subtleBorder }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: impactColor, marginTop: 5, marginRight: 8 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: COLORS.textPrimary, fontSize: 12, lineHeight: 17 }}>{n.headline}</Text>
                        <View style={{ flexDirection: 'row', marginTop: 4, alignItems: 'center' }}>
                          <Text style={{ color: impactColor, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginRight: 8 }}>{n.impact}</Text>
                          <View style={{ flexDirection: 'row' }}>
                            {Array.from({ length: 5 }).map((_, j) => (
                              <View key={j} style={{ width: 4, height: 4, borderRadius: 2, marginRight: 2, backgroundColor: j < Math.ceil((n.relevance ?? 0) / 2) ? impactColor : COLORS.subtleBorder }} />
                            ))}
                          </View>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
            </Card>
          )}

          {/* Economic & Central Bank */}
          {(result.economic_factors?.length ?? 0) > 0 || result.central_bank_outlook ? (
            <Card>
              <Label>ECONOMIC OUTLOOK</Label>
              {(result.economic_factors ?? []).map((f, i) => (
                <Text key={i} style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 17 }}>• {f}</Text>
              ))}
              {result.central_bank_outlook ? (
                <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: COLORS.blue + '10', borderWidth: 1, borderColor: COLORS.blue + '25' }}>
                  <Row>
                    <MaterialCommunityIcons name="bank" size={14} color={COLORS.blue} />
                    <Text style={{ color: COLORS.blue, fontSize: 11, fontWeight: '700', marginLeft: 6 }}>CENTRAL BANK</Text>
                  </Row>
                  <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 17 }}>{result.central_bank_outlook}</Text>
                </View>
              ) : null}
            </Card>
          ) : null}

          {/* Geopolitical Risk */}
          {result.geopolitical_risk ? (
            <Card style={{ borderColor: COLORS.red + '20' }}>
              <Row>
                <MaterialCommunityIcons name="shield-alert-outline" size={16} color={COLORS.red} />
                <Label style={{ color: COLORS.red, marginLeft: 6 }}>GEOPOLITICAL RISK</Label>
              </Row>
              <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 8, lineHeight: 17 }}>{result.geopolitical_risk}</Text>
            </Card>
          ) : null}

          {/* Reasons */}
          {(result.reasons?.length ?? 0) > 0 && (
            <Card>
              <Label>SUPPORTING REASONS</Label>
              {(result.reasons ?? []).map((r, i) => (
                <View key={i} style={{ flexDirection: 'row', marginTop: 8 }}>
                  <MaterialCommunityIcons name="check-circle-outline" size={14} color={COLORS.green} style={{ marginTop: 1, marginRight: 8 }} />
                  <Text style={{ color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, flex: 1 }}>{r}</Text>
                </View>
              ))}
            </Card>
          )}

          {/* Warnings */}
          {(result.warnings?.length ?? 0) > 0 && (
            <Card style={{ borderColor: COLORS.red + '20' }}>
              <Row>
                <MaterialCommunityIcons name="alert-outline" size={16} color={COLORS.red} />
                <Label style={{ color: COLORS.red, marginLeft: 6 }}>WARNINGS</Label>
              </Row>
              {(result.warnings ?? []).map((w, i) => (
                <Text key={i} style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 17 }}>⚠ {w}</Text>
              ))}
            </Card>
          )}

          {/* Refresh */}
          <TouchableOpacity
            onPress={onRefresh}
            style={{ backgroundColor: COLORS.cardBg, borderRadius: 14, paddingVertical: 12, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: COLORS.subtleBorder }}
          >
            <Row>
              <MaterialCommunityIcons name="refresh" size={16} color={COLORS.textSecondary} />
              <Text style={{ color: COLORS.textSecondary, fontSize: 13, fontWeight: '600', marginLeft: 6 }}>Refresh Analysis</Text>
            </Row>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

// ── Layout helpers ───────────────────────────────────────────────────────────
const Card = ({ children, style }: { children: React.ReactNode; style?: any }) => (
  <View style={{ backgroundColor: COLORS.cardBg, borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: COLORS.subtleBorder, ...style }}>{children}</View>
);
const Row = ({ children, style }: { children: React.ReactNode; style?: any }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', ...style }}>{children}</View>
);
const Label = ({ children, style }: { children: React.ReactNode; style?: any }) => (
  <Text style={{ color: COLORS.purple, fontWeight: '700', fontSize: 11, letterSpacing: 0.6, ...style }}>{children}</Text>
);
const Divider = () => (
  <View style={{ borderTopWidth: 1, borderTopColor: COLORS.subtleBorder, marginVertical: 12 }} />
);
