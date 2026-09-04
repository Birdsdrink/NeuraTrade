import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Dimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import COLORS from '../../theme/colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const STEPS = [
  {
    icon: 'chart-line-variant' as const,
    iconBg: COLORS.purple + '20',
    iconColor: COLORS.purple,
    title: 'Live Markets',
    subtitle: 'Real-time price feeds',
    description: 'Track forex, crypto, commodities, and indices with real-time WebSocket data. The candlestick chart updates live — just like a professional trading terminal.',
    accent: COLORS.purple,
  },
  {
    icon: 'brain' as const,
    iconBg: COLORS.blue + '20',
    iconColor: COLORS.blue,
    title: 'AI Analysis',
    subtitle: 'Technical + Fundamental',
    description: 'Get AI-powered buy/sell signals, chart pattern recognition, news sentiment analysis, and structured trade setups — all powered by Qwen VL and Gemini.',
    accent: COLORS.blue,
  },
  {
    icon: 'rocket-launch-outline' as const,
    iconBg: COLORS.green + '20',
    iconColor: COLORS.green,
    title: 'Trade Smarter',
    subtitle: 'Everything in one place',
    description: 'Live signals, technical analysis, fundamental news, and risk management — all from a single app. Make informed decisions, faster.',
    accent: COLORS.green,
  },
];

export default function OnboardingScreen({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const goTo = (index: number) => {
    setStep(index);
    scrollRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
  };

  const handleScroll = (e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    if (idx !== step) setStep(idx);
  };

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bgPrimary }}>
      {/* Skip button */}
      <View style={{ position: 'absolute', top: 56, right: 20, zIndex: 10 }}>
        <TouchableOpacity onPress={onFinish}>
          <Text style={{ color: COLORS.textMuted, fontSize: 14, fontWeight: '600' }}>Skip</Text>
        </TouchableOpacity>
      </View>

      {/* Slides */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
        style={{ flex: 1 }}
      >
        {STEPS.map((s, i) => (
          <View key={i} style={{ width: SCREEN_WIDTH, flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 }}>
            {/* Icon */}
            <View style={{
              width: 120, height: 120, borderRadius: 32,
              backgroundColor: s.iconBg,
              justifyContent: 'center', alignItems: 'center',
              borderWidth: 2, borderColor: s.iconColor + '30',
              marginBottom: 40,
            }}>
              <MaterialCommunityIcons name={s.icon} size={56} color={s.iconColor} />
            </View>

            {/* Text */}
            <Text style={{ fontSize: 28, fontWeight: '800', color: COLORS.textPrimary, textAlign: 'center', marginBottom: 8 }}>
              {s.title}
            </Text>
            <Text style={{ fontSize: 15, fontWeight: '600', color: s.accent, textAlign: 'center', marginBottom: 16 }}>
              {s.subtitle}
            </Text>
            <Text style={{ fontSize: 15, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 }}>
              {s.description}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* Bottom controls */}
      <View style={{ paddingHorizontal: 32, paddingBottom: 60 }}>
        {/* Dots */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 32 }}>
          {STEPS.map((s, i) => (
            <TouchableOpacity key={i} onPress={() => goTo(i)}>
              <View style={{
                width: step === i ? 28 : 8, height: 8, borderRadius: 4,
                backgroundColor: step === i ? current.accent : COLORS.subtleBorder,
                marginHorizontal: 4,
              }} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Next / Get Started */}
        <TouchableOpacity
          onPress={() => isLast ? onFinish() : goTo(step + 1)}
          style={{
            backgroundColor: current.accent, height: 56, borderRadius: 16,
            flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
            {isLast ? 'Get Started' : 'Next'}
          </Text>
          {!isLast && (
            <MaterialCommunityIcons name="arrow-right" size={20} color="#fff" style={{ marginLeft: 8 }} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
