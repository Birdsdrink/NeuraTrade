import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import COLORS from '../theme/colors';

type Tab = 'Markets' | 'ChartAI' | 'Analysis' | 'Fundamental' | 'Settings';
type Screen = 'Markets' | 'MarketDetail' | 'AIAnalysis' | 'Watchlist' | 'FundamentalAnalysis' | 'Settings';

type Props = {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  setCurrentScreen: (screen: Screen) => void;
};

const { width } = Dimensions.get('window');

// Full-width dock, rounded pill, with its bottom dipping slightly below the screen edge
const BAR_WIDTH = width;
const NUM_TABS = 5;
const TAB_WIDTH = BAR_WIDTH / NUM_TABS;
const BAR_HEIGHT = 74; // visible height of the dock
const BOTTOM_OVERHANG = 18; // how far the rounded bottom tucks below the screen
const DOCK_HEIGHT = BAR_HEIGHT + BOTTOM_OVERHANG;
const DOCK_RADIUS = 32;

const ACCENT = COLORS.blue;

// Fade the accent line out near the far left/right edges of the bar
const FADE_W = Math.min(72, BAR_WIDTH * 0.16);
const BAR_COLOR = '#0a0a0c';

const ITEMS: { tab: Tab; screen: Screen; label: string; icon: (color: string) => React.ReactNode }[] = [
  { tab: 'Markets', screen: 'Markets', label: 'Markets', icon: (color) => <Ionicons name="home-outline" size={22} color={color} /> },
  { tab: 'ChartAI', screen: 'Watchlist', label: 'Technicals', icon: (color) => <MaterialCommunityIcons name="chart-timeline-variant" size={21} color={color} /> },
  { tab: 'Analysis', screen: 'AIAnalysis', label: 'Signals', icon: (color) => <MaterialCommunityIcons name="star-four-points" size={21} color={color} /> },
  { tab: 'Fundamental', screen: 'FundamentalAnalysis', label: 'News', icon: (color) => <MaterialCommunityIcons name="newspaper-variant-outline" size={21} color={color} /> },
  { tab: 'Settings', screen: 'Settings', label: 'Settings', icon: (color) => <Feather name="settings" size={21} color={color} /> },
];

// SVG path for the accent line.
// The center of the "bump" sits at X = 0 and the path extends far left/right
// so the whole line stays continuous while it slides under the active tab.
const LINE_Y = 64; // Y of the straight bottom line
const BUMP_PEAK_Y = 12; // Highest point of the curve
const CURVE_WIDTH = 44; // Half width of the bump base — wide enough for long labels to sit clearly between its legs
// Bezier control points scaled proportionally to the base width
const CURVE_C1 = CURVE_WIDTH * 0.469;
const CURVE_C2 = CURVE_WIDTH * 0.781;

const SVG_PATH = `
  M -1000 ${LINE_Y}
  L -${CURVE_WIDTH} ${LINE_Y}
  C -${CURVE_C1} ${LINE_Y}, -${CURVE_C2} ${BUMP_PEAK_Y}, 0 ${BUMP_PEAK_Y}
  C ${CURVE_C2} ${BUMP_PEAK_Y}, ${CURVE_C1} ${LINE_Y}, ${CURVE_WIDTH} ${LINE_Y}
  L 1000 ${LINE_Y}
`;

export default function BottomNavigation({ activeTab, setActiveTab, setCurrentScreen }: Props) {
  const activeIndex = ITEMS.findIndex((item) => item.tab === activeTab);

  // slideAnim tracks the center X of the active tab across the full-width strip
  const slideAnim = useRef(new Animated.Value(TAB_WIDTH / 2 + activeIndex * TAB_WIDTH)).current;
  const popAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: TAB_WIDTH / 2 + activeIndex * TAB_WIDTH,
      tension: 60,
      friction: 10,
      useNativeDriver: false,
    }).start();

    // small icon "pop" when switching tabs
    popAnim.setValue(1.18);
    Animated.spring(popAnim, {
      toValue: 1,
      tension: 200,
      friction: 6,
      useNativeDriver: false,
    }).start();
  }, [activeIndex, slideAnim, popAnim]);

  const select = (item: (typeof ITEMS)[number], index: number) => {
    setActiveTab(item.tab);
    setCurrentScreen(item.screen);
    Animated.spring(slideAnim, {
      toValue: TAB_WIDTH / 2 + index * TAB_WIDTH,
      tension: 60,
      friction: 10,
      useNativeDriver: false,
    }).start();
  };

  return (
    <View pointerEvents="box-none" style={styles.wrapper}>
      <View style={styles.tabBarContainer}>
        {/* Tabs area */}
        <View style={styles.tabsContainer}>
          {/* Animated SVG continuous accent line */}
          <Animated.View
            style={[
              { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
              { transform: [{ translateX: slideAnim }] },
            ]}
          >
            <Svg width="1" height={BAR_HEIGHT} style={{ overflow: 'visible' }}>
              {/* Soft glow */}
              <Path d={SVG_PATH} stroke={ACCENT} strokeWidth={6} strokeOpacity={0.3} fill="none" />
              {/* Core line */}
              <Path d={SVG_PATH} stroke={ACCENT} strokeWidth={2} fill="none" />
            </Svg>
          </Animated.View>

          {/* Static fade overlays at both ends (dock color, over the line) */}
          <Svg
            width={BAR_WIDTH}
            height={BAR_HEIGHT}
            style={{ position: 'absolute', top: 0, left: 0 }}
            pointerEvents="none"
          >
            <Defs>
              <LinearGradient id="fadeLeft" x1="0" y1="0" x2={FADE_W} y2="0" gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={BAR_COLOR} stopOpacity="1" />
                <Stop offset="1" stopColor={BAR_COLOR} stopOpacity="0" />
              </LinearGradient>
              <LinearGradient id="fadeRight" x1={BAR_WIDTH - FADE_W} y1="0" x2={BAR_WIDTH} y2="0" gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={BAR_COLOR} stopOpacity="0" />
                <Stop offset="1" stopColor={BAR_COLOR} stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width={FADE_W} height={BAR_HEIGHT} fill="url(#fadeLeft)" />
            <Rect x={BAR_WIDTH - FADE_W} y="0" width={FADE_W} height={BAR_HEIGHT} fill="url(#fadeRight)" />
          </Svg>

          {ITEMS.map((item, index) => {
            const isActive = item.tab === activeTab;
            return (
              <TouchableOpacity
                key={item.tab}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                style={styles.tab}
                activeOpacity={0.8}
                onPress={() => select(item, index)}
              >
                <View style={styles.iconContainer}>
                  <Animated.View style={[isActive && { transform: [{ scale: popAnim }] }]}>
                    {item.icon(isActive ? ACCENT : '#a0a0a0')}
                  </Animated.View>
                </View>

                <Text numberOfLines={1} style={[styles.tabText, isActive && styles.tabTextActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: -BOTTOM_OVERHANG,
    left: 0,
    right: 0,
  },
  tabBarContainer: {
    width: '100%',
    height: DOCK_HEIGHT,
    position: 'relative',
    backgroundColor: '#0a0a0c',
    borderRadius: DOCK_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 20,
    overflow: 'hidden', // keeps the long SVG line inside the dock
  },
  tabsContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: BAR_HEIGHT,
    flexDirection: 'row',
  },
  tab: {
    width: TAB_WIDTH,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    paddingTop: 4,
  },
  iconContainer: {
    marginBottom: 6,
  },
  tabText: {
    fontSize: 10,
    color: '#a0a0a0',
    fontWeight: '500',
    maxWidth: TAB_WIDTH - 6,
  },
  tabTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
