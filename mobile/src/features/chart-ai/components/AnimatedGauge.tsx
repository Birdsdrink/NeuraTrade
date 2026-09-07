import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import COLORS from '../../../theme/colors';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const SIZE = 200;
const STROKE_WIDTH = 12;
const R = (SIZE - STROKE_WIDTH) / 2;
const CX = SIZE / 2;
const CY = SIZE / 2;

/** 270° arc: starts at 135° (bottom-left), sweeps clockwise to 45° (bottom-right). */
const START_ANGLE = 135;
const SWEEP_DEG = 270;

const polar = (angleDeg: number) => {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) };
};

const start = polar(START_ANGLE);
const end = polar(START_ANGLE + SWEEP_DEG);
const ARC_PATH = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${R} ${R} 0 1 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
const ARC_LENGTH = (SWEEP_DEG / 360) * 2 * Math.PI * R;

interface AnimatedGaugeProps {
  score: number; // 0 - 100
}

const confidenceColor = (score: number) => {
  if (score < 40) return COLORS.red; // low
  if (score < 70) return COLORS.yellow; // medium
  return COLORS.green; // high
};

export default function AnimatedGauge({ score }: AnimatedGaugeProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(score / 100, {
      duration: 1400,
      easing: Easing.out(Easing.cubic),
    });
  }, [score, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: ARC_LENGTH * (1 - progress.value),
  }));

  const color = confidenceColor(score);

  return (
    <View style={{ width: SIZE, height: SIZE }}>
      <Svg width={SIZE} height={SIZE}>
        {/* Faded background track */}
        <Path
          d={ARC_PATH}
          stroke={COLORS.subtleBorder}
          strokeWidth={STROKE_WIDTH}
          fill="none"
          strokeLinecap="round"
        />
        {/* Active animated foreground stroke */}
        <AnimatedPath
          d={ARC_PATH}
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${ARC_LENGTH} ${ARC_LENGTH}`}
          animatedProps={animatedProps}
        />
      </Svg>
      {/* Center score text */}
      <View style={styles.centerText} pointerEvents="none">
        <Text style={[styles.scoreText, { color }]}>{Math.round(score)}</Text>
        <Text style={styles.ofText}>/100</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centerText: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: {
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -1,
    color: COLORS.textPrimary,
  },
  ofText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: -4,
  },
});
