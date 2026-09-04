import React from 'react';
import { ScrollView, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import COLORS from '../../theme/colors';
import AppHeader from '../../components/AppHeader';
import MarketCard from '../../components/MarketCard';
import { WATCHLIST } from '../../features/markets/data/mockMarketData';
import { Market } from '../../domain/entities/Market';

export default function WatchlistScreen({ navigation, onMarketSelect }: { navigation: (screen: 'Markets' | 'MarketDetail' | 'AIAnalysis' | 'Watchlist' | 'Settings') => void; onMarketSelect: (market: Market) => void }) {
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
      <AppHeader title="My Watchlist" />

      {WATCHLIST.map((item, idx) => (
        <MarketCard key={idx} item={item} onPress={() => onMarketSelect(item)} />
      ))}
    </ScrollView>
  );
}
