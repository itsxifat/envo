import { useEffect } from 'react';
import Constants from 'expo-constants';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold } from '@expo-google-fonts/geist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { UpdateScreen } from '@/features/onboarding/Notices';
import { CallsProvider } from '@/state/calls';
import { ContactsProvider } from '@/state/contacts';
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
            <ContactsProvider>
              <CallsProvider>
                <Navigator />
              </CallsProvider>
            </ContactsProvider>
          </SettingsProvider>
        </SessionProvider>
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}

/** "1.2.0" < "1.10.0": compares versions part by part. */
function older(version: string, than: string): boolean {
  const a = version.split('.').map(Number);
  const b = than.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

/**
 * Where you can go depends on where you are: the welcome pages before signing in, the email code and
 * the KYC form until they are done, then the phone itself (or a notice when the account is paused).
 */
function Navigator() {
  const { dark, colors } = useTheme();
  const { ready, account, config } = useSession();
  // The splash stays up until we know whether someone is signed in.
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  const stage = account?.stage;
  const phone = stage === 'activate' || stage === 'registering' || stage === 'active';
  const base = dark ? DarkTheme : DefaultTheme;
  if (!ready) return null;
  if (config && older(Constants.expoConfig?.version ?? '0.0.0', config.min_app_version)) return <UpdateScreen url={config.update_url} />;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, background: colors.background } }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Protected guard={!account}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={stage === 'verify'}>
          <Stack.Screen name="verify" />
        </Stack.Protected>
        <Stack.Protected guard={stage === 'kyc'}>
          <Stack.Screen name="kyc" />
        </Stack.Protected>
        <Stack.Protected guard={stage === 'suspended'}>
          <Stack.Screen name="paused" />
        </Stack.Protected>
        <Stack.Protected guard={phone}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="your-number" options={{ animation: 'fade' }} />
          <Stack.Screen name="activate" />
          <Stack.Screen name="recharge" />
          <Stack.Screen name="ringtone" />
          <Stack.Screen name="password" />
          <Stack.Screen name="call" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="incoming" options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
