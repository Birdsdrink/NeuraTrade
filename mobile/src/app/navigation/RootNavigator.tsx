import React from 'react';
import { View } from 'react-native';
import MarketsScreen from '../../screens/Markets/MarketsScreen';
import MarketDetailScreen from '../../screens/MarketDetail/MarketDetailScreen';
import AIAnalysisScreen from '../../screens/AIAnalysis/AIAnalysisScreen';
import ChartAnalysisScreen from '../../screens/ChartAnalysis/ChartAnalysisScreen';
import FundamentalAnalysisScreen from '../../screens/FundamentalAnalysis/FundamentalAnalysisScreen';
import SettingsScreen from '../../screens/Settings/SettingsScreen';
import BottomNavigation from '../../components/BottomNavigation';
import { Market } from '../../domain/entities/Market';

export type Screen = 'Markets' | 'MarketDetail' | 'AIAnalysis' | 'Watchlist' | 'FundamentalAnalysis' | 'Settings';
export type Tab = 'Markets' | 'ChartAI' | 'Analysis' | 'Fundamental' | 'Settings';

export default function RootNavigator() {
  const [currentScreen, setCurrentScreen] = React.useState<Screen>('Markets');
  const [activeTab, setActiveTab] = React.useState<Tab>('Markets');
  const [selectedMarket, setSelectedMarket] = React.useState<Market | null>(null);
  const [analysisTimeframe, setAnalysisTimeframe] = React.useState('1H');

  const openMarket = (market: Market) => {
    setSelectedMarket(market);
    setCurrentScreen('MarketDetail');
  };
  const openAnalysis = (timeframe: string) => {
    setAnalysisTimeframe(timeframe);
    setCurrentScreen('AIAnalysis');
  };

  return (
    <View style={{ flex: 1 }}>
      {currentScreen === 'Markets' && <MarketsScreen navigation={setCurrentScreen} onMarketSelect={openMarket} />}
      {currentScreen === 'MarketDetail' && <MarketDetailScreen navigation={setCurrentScreen} market={selectedMarket} onOpenAnalysis={openAnalysis} />}
      {currentScreen === 'AIAnalysis' && <AIAnalysisScreen navigation={setCurrentScreen} market={selectedMarket} timeframe={analysisTimeframe} />}
      {currentScreen === 'Watchlist' && <ChartAnalysisScreen navigation={setCurrentScreen} preselectedMarket={selectedMarket} />}
      {currentScreen === 'FundamentalAnalysis' && <FundamentalAnalysisScreen navigation={setCurrentScreen} preselectedMarket={selectedMarket} />}
      {currentScreen === 'Settings' && <SettingsScreen navigation={setCurrentScreen} />}

      <BottomNavigation activeTab={activeTab} setActiveTab={(t) => setActiveTab(t)} setCurrentScreen={setCurrentScreen} />
    </View>
  );
}
