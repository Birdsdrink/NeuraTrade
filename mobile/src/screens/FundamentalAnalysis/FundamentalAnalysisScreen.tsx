import React, { useState, useCallback } from 'react';
import {
  ScrollView, View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, Image,
} from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import COLORS from '../../theme/colors';
import AppHeader from '../../components/AppHeader';
import { useMarkets } from '../../features/markets/hooks/useMarkets';
import { Market } from '../../domain/entities/Market';
import { aiClient } from '../../services/api/apiClient';
import { useSettings } from '../../hooks/useSettings';
import { maybeSendAlignedSignalNotification, updateNewsSignal } from '../../services/signalNotifications';

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

function humanText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^[\[{]/.test(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed);
        return humanText(parsed);
      } catch {
        return trimmed
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
    return trimmed.replace(/\\n/g, '\n').replace(/\\t/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => humanText(item)).filter(Boolean).join('; ');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred = ['analysis', 'summary', 'text', 'headline', 'message', 'title'];
    for (const key of preferred) {
      const text = humanText(record[key]);
      if (text) return text;
    }
    return Object.entries(record)
      .map(([key, item]) => `${key}: ${humanText(item)}`)
      .filter(Boolean)
      .join('; ');
  }
  return String(value);
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => humanText(item))
      .filter((item) => item && item !== 'undefined' && item !== 'null');
  }

  if (typeof value === 'string') {
    return value
      .split(/\n|;|\|/)
      .map((item) => item.trim())
      .filter((item) => item && item !== 'undefined' && item !== 'null');
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((item) => humanText(item))
      .filter((item) => item && item !== 'undefined' && item !== 'null');
  }

  return [];
}

function normalizeNewsImpact(value: unknown): NewsImpact[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const headline = humanText(record.headline) || humanText(record.title) || 'Market update';
      const impact = String(record.impact ?? 'neutral').toLowerCase();
      const relevance = Number(record.relevance ?? 0) || 0;
      return {
        headline,
        impact: impact === 'bullish' || impact === 'bearish' ? impact : 'neutral',
        relevance: Math.max(0, Math.min(10, relevance)),
      };
    })
    .filter(Boolean) as NewsImpact[];
}

function normalizeFundamentalResult(data: unknown): FundResult {
  const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const warnings = normalizeList(record.warnings);
  const keyThemes = normalizeList(record.key_themes);
  const reasons = normalizeList(record.reasons);
  const economicFactors = normalizeList(record.economic_factors);

  return {
    instrument: humanText(record.instrument) || 'Market',
    sentiment: humanText(record.sentiment) || 'neutral',
    sentiment_score: Number(record.sentiment_score) || 0,
    confidence: Number(record.confidence) || 0,
    recommendation: humanText(record.recommendation) || 'WAIT',
    bias: humanText(record.bias) || 'No explicit bias available.',
    key_themes: keyThemes.length ? keyThemes : ['Market tone is mixed while traders wait for stronger confirmation.'],
    news_impact: normalizeNewsImpact(record.news_impact),
    economic_factors: economicFactors.length ? economicFactors : ['Macro and policy expectations remain the key driver of sentiment.'],
    central_bank_outlook: humanText(record.central_bank_outlook) || 'Central bank guidance is being monitored closely.',
    geopolitical_risk: humanText(record.geopolitical_risk) || 'Geopolitical headlines are being monitored.',
    analysis: humanText(record.analysis) || humanText(record.bias) || 'No analysis summary available.',
    reasons: reasons.length ? reasons : ['The latest market news has not yet created a decisive directional edge.'],
    warnings: warnings.length ? warnings : ['Unable to fully parse the latest AI response; showing a fallback summary.'],
    news_count: Number(record.news_count) || 0,
  };
}

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
  const [showResults, setShowResults] = useState(false);
  const { data: markets = [] } = useMarkets();
  const normalizedResult = normalizeFundamentalResult(result);

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

  const sentiment = (normalizedResult.sentiment ?? '').toLowerCase();
  const sentimentColor =
    sentiment === 'bullish' ? COLORS.green :
    sentiment === 'bearish' ? COLORS.red : COLORS.yellow;

  const readableAnalysis = humanText(normalizedResult.analysis ?? normalizedResult.bias ?? '');
  const readableGeopoliticalRisk = humanText(normalizedResult.geopolitical_risk ?? '');
  const readableCentralBank = humanText(normalizedResult.central_bank_outlook ?? '');

  const rec = (normalizedResult.recommendation ?? '').toUpperCase();
  const recColor =
    rec === 'BUY' ? COLORS.green :
    rec === 'SELL' ? COLORS.red : COLORS.yellow;

  const runAnalysis = useCallback(async (market: Market) => {
    setSelectedMarket(market);
    setShowResults(true);
    setLoading(true);
    setResult(null);
    try {
      const { data } = await aiClient.post('/fundamental-analysis', {
        symbol: market.symbol,
        display_name: market.displayName ?? market.symbol,
      });
      const safeResult = normalizeFundamentalResult(data);
      setResult(safeResult);
      updateNewsSignal(market.symbol, safeResult.recommendation);
      await maybeSendAlignedSignalNotification({
        symbol: market.symbol,
        displayName: market.displayName ?? market.symbol,
        newsRecommendation: safeResult.recommendation,
      });
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

  const goBackToSelector = () => {
    setShowResults(false);
    setResult(null);
    setLoading(false);
  };

  if (showResults) {
    return (
      <ScrollView
        contentContainerStyle={{ paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.purple} />}
      >
        <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: COLORS.subtleBorder, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <TouchableOpacity
                onPress={goBackToSelector}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: COLORS.cardBg,
                  borderWidth: 1,
                  borderColor: COLORS.subtleBorder,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 10,
                }}
              >
                <Ionicons name="arrow-back" size={18} color={COLORS.textPrimary} />
              </TouchableOpacity>
              <Image source={require('../../../assets/icon.png')} style={{ width: 32, height: 32, borderRadius: 8, marginRight: 8 }} />
              <View>
                <Text style={{ fontSize: 14, fontWeight: '800' }}>
                  <Text style={{ color: COLORS.blue }}>Neura</Text>
                  <Text style={{ color: COLORS.green }}>Trade</Text>
                </Text>
                <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 1 }}>
                  {selectedMarket?.displayName ?? selectedMarket?.symbol ?? 'Fundamental Analysis'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: COLORS.cardBg,
                justifyContent: 'center',
                alignItems: 'center',
                borderWidth: 1,
                borderColor: COLORS.subtleBorder,
              }}
            >
              <Ionicons name="notifications-outline" size={16} color={COLORS.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

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

        {normalizedResult && !loading && (
          <>
            <Card style={{ borderColor: sentimentColor + '30' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1 }}>
                  <Row>
                    <MaterialCommunityIcons name="newspaper-variant-outline" size={18} color={COLORS.purple} />
                    <Text style={{ color: COLORS.purple, fontWeight: '700', fontSize: 11, marginLeft: 6, letterSpacing: 0.6 }}>FUNDAMENTAL ANALYSIS</Text>
                  </Row>
                  <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 6 }}>
                    {normalizedResult.instrument} · {normalizedResult.news_count ?? 0} news articles
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
                  {(normalizedResult.sentiment ?? 'Neutral').charAt(0).toUpperCase() + (normalizedResult.sentiment ?? 'neutral').slice(1)}
                </Text>
                {normalizedResult.sentiment_score != null && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: COLORS.subtleBorder, overflow: 'hidden' }}>
                      <View style={{
                        height: '100%', borderRadius: 2,
                        width: `${Math.min(100, Math.abs(normalizedResult.sentiment_score))}%`,
                        backgroundColor: sentimentColor,
                      }} />
                    </View>
                    <Text style={{ color: COLORS.textMuted, fontSize: 11, marginLeft: 8, minWidth: 36, textAlign: 'right' }}>
                      {normalizedResult.sentiment_score > 0 ? '+' : ''}{normalizedResult.sentiment_score}
                    </Text>
                  </View>
                )}
              </View>

              <Divider />
              <Text style={{ color: COLORS.textSecondary, fontSize: 13, lineHeight: 20 }}>
                {readableAnalysis || normalizedResult.bias || 'No analysis summary available.'}
              </Text>
              <Divider />
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>Confidence</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: sentimentColor }}>{normalizedResult.confidence ?? 0}%</Text>
              </Row>
            </Card>

            {(normalizedResult.key_themes?.length ?? 0) > 0 && (
              <Card>
                <Label>KEY THEMES</Label>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingTop: 8, paddingRight: 8 }}
                  style={{ marginTop: 2 }}
                >
                  {(normalizedResult.key_themes ?? []).map((t, i) => (
                    <View
                      key={i}
                      style={{
                        backgroundColor: COLORS.purple + '15',
                        borderRadius: 8,
                        paddingHorizontal: 8,
                        paddingVertical: 5,
                        marginRight: 6,
                        borderWidth: 1,
                        borderColor: COLORS.purple + '25',
                        maxWidth: 180,
                      }}
                    >
                      <Text numberOfLines={2} style={{ color: COLORS.purple, fontSize: 10.5, fontWeight: '600' }}>
                        {t}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </Card>
            )}

            {(normalizedResult.news_impact?.length ?? 0) > 0 && (
              <Card>
                <Label>NEWS IMPACT</Label>
                {(normalizedResult.news_impact ?? []).slice(0, 5).map((n, i) => {
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

            {(normalizedResult.economic_factors?.length ?? 0) > 0 || normalizedResult.central_bank_outlook ? (
              <Card>
                <Label>ECONOMIC OUTLOOK</Label>
                {(normalizedResult.economic_factors ?? []).map((f, i) => (
                  <Text key={i} style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 17 }}>• {f}</Text>
                ))}
                {readableCentralBank ? (
                  <View style={{ marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: COLORS.blue + '10', borderWidth: 1, borderColor: COLORS.blue + '25' }}>
                    <Row>
                      <MaterialCommunityIcons name="bank" size={14} color={COLORS.blue} />
                      <Text style={{ color: COLORS.blue, fontSize: 11, fontWeight: '700', marginLeft: 6 }}>CENTRAL BANK</Text>
                    </Row>
                    <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 17 }}>{readableCentralBank}</Text>
                  </View>
                ) : null}
              </Card>
            ) : null}

            {readableGeopoliticalRisk ? (
              <Card style={{ borderColor: COLORS.red + '20' }}>
                <Row>
                  <MaterialCommunityIcons name="shield-alert-outline" size={16} color={COLORS.red} />
                  <Label style={{ color: COLORS.red, marginLeft: 6 }}>GEOPOLITICAL RISK</Label>
                </Row>
                <Text style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 8, lineHeight: 17 }}>{readableGeopoliticalRisk}</Text>
              </Card>
            ) : null}

            {(normalizedResult.reasons?.length ?? 0) > 0 && (
              <Card>
                <Label>SUPPORTING REASONS</Label>
                {(normalizedResult.reasons ?? []).map((r, i) => (
                  <View key={i} style={{ flexDirection: 'row', marginTop: 8 }}>
                    <MaterialCommunityIcons name="check-circle-outline" size={14} color={COLORS.green} style={{ marginTop: 1, marginRight: 8 }} />
                    <Text style={{ color: COLORS.textSecondary, fontSize: 12, lineHeight: 17, flex: 1 }}>{r}</Text>
                  </View>
                ))}
              </Card>
            )}

            {(normalizedResult.warnings?.length ?? 0) > 0 && (
              <Card style={{ borderColor: COLORS.red + '20' }}>
                <Row>
                  <MaterialCommunityIcons name="alert-outline" size={16} color={COLORS.red} />
                  <Label style={{ color: COLORS.red, marginLeft: 6 }}>WARNINGS</Label>
                </Row>
                {(normalizedResult.warnings ?? []).map((w, i) => (
                  <Text key={i} style={{ color: COLORS.textSecondary, fontSize: 12, marginTop: 6, lineHeight: 17 }}>⚠ {w}</Text>
                ))}
              </Card>
            )}

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

  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingBottom: 140 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.purple} />}
    >
      <AppHeader title="Fundamental Analysis" subtitle="AI-powered news sentiment" />

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

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
          {markets.slice(0, 100).map((m) => {
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

      {!result && !loading && (
        <View>
          {Object.entries(grouped).slice(0, 8).map(([category, items]) => (
            <View key={category} style={{ marginBottom: 12 }}>
              <Text style={{ color: COLORS.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 }}>{category.toUpperCase()}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {items.slice(0, 12).map((m) => (
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
