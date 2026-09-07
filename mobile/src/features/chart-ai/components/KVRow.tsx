import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import COLORS from '../../../theme/colors';

interface Props {
  label: string;
  value: string;
  valueColor?: string;
}

export default function KVRow({ label, value, valueColor }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.subtleBorder,
  },
  label: {
    color: COLORS.textMuted,
    fontSize: 12.5,
  },
  value: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
});
