import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import COLORS from '../../../theme/colors';

interface Props {
  title: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  children: React.ReactNode;
}

export default function SectionCard({ title, icon, children }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.iconBadge}>
          <MaterialCommunityIcons name={icon} size={15} color={COLORS.purple} />
        </View>
        <Text style={styles.title}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.subtleBorder,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(117,87,247,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  title: {
    color: COLORS.textPrimary,
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.4,
  },
});
