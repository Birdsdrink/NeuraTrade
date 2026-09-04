import React, { useState, useEffect } from 'react';
import { View } from 'react-native';
import SplashScreen from '../screens/Splash/SplashScreen';
import OnboardingScreen from '../screens/Onboarding/OnboardingScreen';
import RootNavigator from './navigation/RootNavigator';
import COLORS from '../theme/colors';

type AppState = 'splash' | 'onboarding' | 'main';

export default function AppRoot() {
  const [state, setState] = useState<AppState>('splash');

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bgPrimary }}>
      {state === 'splash' && (
        <SplashScreen onFinish={() => setState('onboarding')} />
      )}
      {state === 'onboarding' && (
        <OnboardingScreen onFinish={() => setState('main')} />
      )}
      {state === 'main' && (
        <RootNavigator />
      )}
    </View>
  );
}
