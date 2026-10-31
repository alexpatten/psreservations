import { DefaultTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DialogHost } from '@/components/Dialogs';
import { WEB_FONT } from '@/components/ui';
import { AuthProvider } from '@/lib/auth';
import { backgroundGradient, useColors } from '@/lib/theme';

export default function RootLayout() {
  const c = useColors();

  // On the web the page itself carries Pickle Spots' background gradient (no court lines).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.body.style.background = backgroundGradient;
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.minHeight = '100vh';
    document.body.style.fontFamily = WEB_FONT;
    document.documentElement.style.colorScheme = 'light';
    document.title = 'Pickle Spots Reservations';
  }, []);

  // Pickle Spots green, and a see-through background on the web so the page's gradient shows.
  const theme: Theme = {
    ...DefaultTheme,
    colors: { ...DefaultTheme.colors, primary: c.tint, background: Platform.OS === 'web' ? 'transparent' : c.background, card: c.card, border: c.cardBorder },
  };

  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <AuthProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }} />
          <DialogHost />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
