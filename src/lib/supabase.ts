import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
// The publishable key is meant to ship in the app; Row Level Security protects the data.
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY!;

/** Same Supabase project as Pickle Spots, so players sign in with their Pickle Spots account. */
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    // AsyncStorage is localStorage on the web. Rendering on the server has neither.
    storage: typeof window === 'undefined' && Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

/**
 * A client that never saves a session, for creating accounts at the kiosk without signing the
 * staff member out.
 */
export const signUpClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'kiosk-signup' },
});

if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
