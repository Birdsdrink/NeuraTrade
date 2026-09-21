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

const { width, height } = Dimensions.get('window');
const isSmallDevice = width < 360 || height < 700;

// Full-width dock, rounded pill, with its bottom dipping slightly below the screen edge
const BAR_WIDTH = width;
const NUM_TABS = 5;
const TAB_WIDTH = BAR_WIDTH / NUM_TABS;
const BAR_HEIGHT = isSmallDevice ? 66 : 74; // visible height of the dock
const BOTTOM_OVERHANG = isSmallDevice ? 14 : 18; // how far the rounded bottom tucks below the screen
const DOCK_HEIGHT = BAR_HEIGHT + BOTTOM_OVERHANG;
const DOCK_RADIUS = isSmallDevice ? 26 : 32;

const ACCENT = COLORS.blue;

// Fade the accent line out near the far left/right edges of the bar
const FADE_W = Math.min(72, BAR_WIDTH * 0.16);
const BAR_COLOR = '#0a0a0c';
const SCREEN_BG = COLORS.bgPrimary; // used for the notch "cutout" behind the floating circle

// How far the active icon raises up out of the bar (into the floating circle)
const ICON_RAISE = isSmallDevice ? 20 : 26;

// Notch / floating circle geometry
const NOTCH_SIZE = isSmallDevice ? 50 : 58;
const CIRCLE_SIZE = isSmallDevice ? 40 : 46;

const ITEMS: { tab: Tab; screen: Screen; label: string; icon: (color: string) => React.ReactNode }[] = [
  { tab: 'Markets', screen: 'Markets', label: 'Markets', icon: (color) => <Ionicons name="home-outline" size={isSmallDevice ? 18 : 22} color={color} /> },
  { tab: 'ChartAI', screen: 'Watchlist', label: 'Technicals', icon: (color) => <MaterialCommunityIcons name="chart-timeline-variant" size={isSmallDevice ? 18 : 21} color={color} /> },
  { tab: 'Analysis', screen: 'AIAnalysis', label: 'Signals', icon: (color) => <MaterialCommunityIcons name="star-four-points" size={isSmallDevice ? 18 : 21} color={color} /> },
  { tab: 'Fundamental', screen: 'FundamentalAnalysis', label: 'News', icon: (color) => <MaterialCommunityIcons name="newspaper-variant-outline" size={isSmallDevice ? 18 : 21} color={color} /> },
  { tab: 'Settings', screen: 'Settings', label: 'Settings', icon: (color) => <Feather name="settings" size={isSmallDevice ? 18 : 21} color={color} /> },
];

// SVG path for the accent line — flipped to the TOP of the dock ("upside down" vs the old bottom line).
// The center of the "bump" sits at X = 0 and the path extends far left/right so the whole
// line stays continuous while it slides under the active tab.
// The bump itself is also rotated upside down: instead of arching upward, it DIPS DOWNWARD
// into the bar beneath the active tab (the raised icon floats above the valley).
const LINE_Y = 12; // Y of the straight line, measured from the dock's top edge
const BUMP_PEAK_Y = 43; // the bump dips down into the bar — between the circle bottom (28) and the label text (~49)
const CURVE_WIDTH = 54; // Half width of the bump base — wider than the circle (46) so it sits well inside the arc
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
  const activeIndex = Math.max(0, ITEMS.findIndex((item) => item.tab === activeTab));

  // One animated value tracks the active INDEX; everything else interpolates from it:
  // - the accent-line bump slides to the center of the active tab
  // - the notch + floating circle slide beneath the active tab
  // - the active icon raises up into the floating circle
  const slideVal = useRef(new Animated.Value(activeIndex)).current;
  const popAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(slideVal, {
      toValue: activeIndex,
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
  }, [activeIndex, slideVal, popAnim]);

  // Accent line translateX: bump center = center of the active tab
  const lineTranslateX = slideVal.interpolate({
    inputRange: ITEMS.map((_, i) => i),
    outputRange: ITEMS.map((_, i) => TAB_WIDTH / 2 + i * TAB_WIDTH),
  });

  // Notch + floating circle translateX: left edge of the active tab
  const indicatorTranslateX = slideVal.interpolate({
    inputRange: ITEMS.map((_, i) => i),
    outputRange: ITEMS.map((_, i) => i * TAB_WIDTH),
  });

  const select = (item: (typeof ITEMS)[number], index: number) => {
    setActiveTab(item.tab);
    setCurrentScreen(item.screen);
    Animated.spring(slideVal, {
      toValue: index,
      tension: 60,
      friction: 10,
      useNativeDriver: false,
    }).start();
  };

  return (
    <View style={[styles.wrapper, { pointerEvents: 'box-none' }]}>
      <View style={styles.tabBarContainer}>
        {/* Animated SVG continuous accent line (top of the dock) */}
        <Animated.View
          style={[
            { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
            { transform: [{ translateX: lineTranslateX }] },
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
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
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

        {/* Sliding notch + floating circle (holds the raised active icon) */}
        <Animated.View
          style={[styles.slidingIndicatorContainer, { transform: [{ translateX: indicatorTranslateX }] }]}
        >
          <View style={styles.notchCutout}>
            <View style={styles.floatingCircle} />
          </View>
        </Animated.View>

        {/* Tab buttons */}
        <View style={styles.tabsContainer}>
          {ITEMS.map((item, index) => {
            const isActive = item.tab === activeTab;

            // Active icon raises up out of the bar into the floating circle
            const translateY = slideVal.interpolate({
              inputRange: [index - 1, index, index + 1],
              outputRange: [0, -ICON_RAISE, 0],
              extrapolate: 'clamp',
            });

            return (
              <TouchableOpacity
                key={item.tab}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                style={styles.tab}
                activeOpacity={0.8}
                onPress={() => select(item, index)}
              >
                <View style={isActive ? styles.activeIconContainer : styles.iconContainer}>
                  <Animated.View style={[
                    isActive && { transform: [{ translateY }, { scale: popAnim }] },
                    !isActive && { transform: [{ translateY: 0 }] },
                  ]}>
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
    backgroundColor: BAR_COLOR,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: DOCK_RADIUS,
    borderBottomRightRadius: DOCK_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    boxShadow: '0px -10px 20px rgba(0,0,0,0.35)',
    elevation: 20,
  },
  slidingIndicatorContainer: {
    position: 'absolute',
    top: 0,
    width: TAB_WIDTH,
    height: BAR_HEIGHT,
    alignItems: 'center',
    zIndex: 1,
  },
  notchCutout: {
    // Circle in the screen background color — the "hole" in the bar behind the floating circle
    width: NOTCH_SIZE,
    height: NOTCH_SIZE,
    borderRadius: NOTCH_SIZE / 2,
    backgroundColor: SCREEN_BG,
    position: 'absolute',
    top: -(NOTCH_SIZE / 2) + 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingCircle: {
    // The actual floating circle holding the raised active icon
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: BAR_COLOR,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
    boxShadow: `0px 0px 12px ${ACCENT}66`,
    elevation: 8,
    marginTop: 6,
  },
  tabsContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: BAR_HEIGHT,
    flexDirection: 'row',
    zIndex: 2,
  },
  tab: {
    width: TAB_WIDTH,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: isSmallDevice ? 2 : 4,
    paddingBottom: 2,
  },
  iconContainer: {
    marginBottom: isSmallDevice ? 2 : 3,
  },
  activeIconContainer: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: isSmallDevice ? 2 : 3,
  },
  tabText: {
    fontSize: isSmallDevice ? 9 : 10,
    color: '#a0a0a0',
    fontWeight: '500',
    maxWidth: TAB_WIDTH - 8,
    lineHeight: isSmallDevice ? 10 : 11,
  },
  tabTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
});