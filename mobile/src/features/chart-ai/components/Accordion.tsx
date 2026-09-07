import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import COLORS from '../../../theme/colors';

interface Props {
  title: string;
  content: string;
}

export default function Accordion({ title, content }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.item, open && styles.itemOpen]}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setOpen((o) => !o)}
        style={styles.header}
      >
        <Text style={styles.title}>{title}</Text>
        <MaterialCommunityIcons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={COLORS.textMuted}
        />
      </TouchableOpacity>
      {open && <Text style={styles.content}>{content}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.subtleBorder,
    marginBottom: 8,
    overflow: 'hidden',
  },
  itemOpen: {
    borderColor: 'rgba(117,87,247,0.4)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 13.5,
    fontWeight: '600',
    flex: 1,
  },
  content: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
});
