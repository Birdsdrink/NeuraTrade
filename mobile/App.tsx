import React from 'react';
import { SafeAreaView, StatusBar, StyleSheet } from 'react-native';
import AppProviders from './src/app/providers/AppProviders';
import AppRoot from './src/app/AppRoot';
import COLORS from './src/theme/colors';

export default function App() {
  return (
    <AppProviders>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bgPrimary} />
        <AppRoot />
      </SafeAreaView>
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
  },
});
