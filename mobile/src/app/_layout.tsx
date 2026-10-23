import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold } from '@expo-google-fonts/geist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { CallsProvider } from '@/state/calls';
import { SessionProvider, useSession } from '@/state/session';
import { SettingsProvider } from '@/state/settings';
import { AppThemeProvider, useTheme } from '@/theme/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold });
  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppThemeProvider>
        <SessionProvider>
          <SettingsProvider>
            <CallsProvider>
              <Navigator />
            </CallsProvider>
          </SettingsProvider>
        </SessionProvider>
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Where you can go depends on where you are: the welcome pages before signing in, the KYC form
 * until it is sent, then the phone itself.
 */
function Navigator() {
  const { dark, colors } = useTheme();
  const { ready, account } = useSession();
  // The splash stays up until we know whether someone is signed in.
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  const inKyc = account?.stage === 'kyc';
  const base = dark ? DarkTheme : DefaultTheme;
  if (!ready) return null;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, background: colors.background } }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Protected guard={!account}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={inKyc}>
          <Stack.Screen name="kyc" />
        </Stack.Protected>
        <Stack.Protected guard={!!account && !inKyc}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="your-number" options={{ animation: 'fade' }} />
          <Stack.Screen name="activate" />
          <Stack.Screen name="recharge" />
          <Stack.Screen name="ringtone" />
          <Stack.Screen name="call" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="incoming" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
