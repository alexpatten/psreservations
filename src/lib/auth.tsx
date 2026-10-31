import type { AuthError, Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { myProfile, type Profile } from './api';
import { signUpClient, supabase } from './supabase';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: Status;
  session: Session | null;
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** Creates a Pickle Spots account; Supabase emails a link to confirm it before it can sign in. */
  register: (input: RegisterInput) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export interface RegisterInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Supabase Auth errors in Pickle Spots' voice. */
export function friendly(error: AuthError): Error {
  switch (error.code) {
    case 'invalid_credentials':
      return new Error('Incorrect email or password.');
    case 'email_not_confirmed':
      return new Error('Confirm your email first: tap the link we sent when you signed up.');
    case 'user_already_exists':
    case 'email_exists':
      return new Error('An account with this email already exists. Sign in instead.');
    case 'weak_password':
      return new Error('Choose a longer password (at least 8 characters).');
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return new Error('Too many tries. Wait a minute and try again.');
    default:
      return new Error(error.message);
  }
}

/** Account sign-up, shared with the kiosk's registration station (which mustn't sign the staff member out). */
export async function registerAccount(input: RegisterInput, client = supabase) {
  const { error } = await client.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: { data: { first_name: input.firstName.trim(), last_name: input.lastName.trim() } },
  });
  if (error) throw friendly(error);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setStatus(data.session ? 'signedIn' : 'signedOut');
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setStatus(next ? 'signedIn' : 'signedOut');
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }
    myProfile(userId).then(setProfile, () => setProfile(null));
  }, [userId]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw friendly(error);
  }, []);

  const register = useCallback((input: RegisterInput) => registerAccount(input, signUpClient), []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (error) throw friendly(error);
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ status, session, profile, signIn, register, sendPasswordReset, signOut }),
    [status, session, profile, signIn, register, sendPasswordReset, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
