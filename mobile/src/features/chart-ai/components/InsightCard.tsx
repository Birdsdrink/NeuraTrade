import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import COLORS from '../../../theme/colors';

interface Props {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  value: string;
}

export default function InsightCard({ icon, label, value }: Props) {
  return (
    <View style={styles.card}>
      <MaterialCommunityIcons name={icon} size={20} color={COLORS.cyan} />
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '48%',
    backgroundColor: COLORS.elevatedCard,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.subtleBorder,
    marginBottom: '4%',
  },
  label: {
    color: COLORS.textMuted,
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginTop: 8,
  },
  value: {
    color: COLORS.textPrimary,
    fontSize: 14.5,
    fontWeight: '700',
    marginTop: 2,
  },
});
