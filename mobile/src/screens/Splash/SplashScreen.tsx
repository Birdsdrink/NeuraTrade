import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import COLORS from '../../theme/colors';

export default function SplashScreen({ onFinish }: { onFinish: () => void }) {
  const fade = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.6)).current;
  const dotOpacities = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;

  useEffect(() => {
    // Logo fade + scale in
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 40, useNativeDriver: true }),
    ]).start();

    // Loading dots cascade
    const dots = dotOpacities.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 300, useNativeDriver: true }),
        ])
      )
    );
    Animated.parallel(dots).start();

    // Finish after 2s
    const timer = setTimeout(onFinish, 2200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bgPrimary, justifyContent: 'center', alignItems: 'center' }}>
      {/* Background glow */}
      <View style={{
        position: 'absolute', width: 300, height: 300, borderRadius: 150,
        backgroundColor: COLORS.purple + '15',
        top: '30%', transform: [{ translateX: -150 }, { translateY: -150 }],
      }} />

      {/* Logo */}
      <Animated.View style={{ opacity: fade, transform: [{ scale }], alignItems: 'center' }}>
        <View style={{
          width: 88, height: 88, borderRadius: 24,
          backgroundColor: COLORS.purple + '20',
          justifyContent: 'center', alignItems: 'center',
          borderWidth: 2, borderColor: COLORS.purple + '40',
          marginBottom: 24,
        }}>
          <MaterialCommunityIcons name="chart-line-variant" size={44} color={COLORS.purple} />
        </View>

        <Text style={{ fontSize: 32, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: -0.5 }}>
          NeuraTrade
        </Text>
        <Text style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 6, letterSpacing: 2, fontWeight: '600' }}>
          AI TRADING ASSISTANT
        </Text>
      </Animated.View>

      {/* Loading dots */}
      <View style={{ position: 'absolute', bottom: 100, flexDirection: 'row', gap: 8 }}>
        {dotOpacities.map((dot, i) => (
          <Animated.View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.purple, opacity: dot }} />
        ))}
      </View>
    </View>
  );
}
