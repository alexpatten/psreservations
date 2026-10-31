import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AppHeader, Logo } from '@/components/AppHeader';
import { Banner, Body, Button, Card, ErrorText, Field, Page, Segmented, Small, Title } from '@/components/ui';
import { useAuth } from '@/lib/auth';

type Mode = 'signIn' | 'register' | 'reset';

export default function SignIn() {
  const params = useLocalSearchParams<{ mode?: string; next?: string }>();
  const { status, signIn, register, sendPasswordReset } = useAuth();
  const [mode, setMode] = useState<Mode>(params.mode === 'register' ? 'register' : 'signIn');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const next = typeof params.next === 'string' && params.next.startsWith('/') ? params.next : '/';
  useEffect(() => {
    if (status === 'signedIn') router.replace(next as never);
  }, [status, next]);

  const submit = async () => {
    setError(null);
    try {
      if (mode === 'signIn') {
        await signIn(email, password);
      } else if (mode === 'register') {
        if (!firstName.trim() || !lastName.trim()) throw new Error('Enter your first and last name.');
        if (password.length < 8) throw new Error('Choose a password of at least 8 characters.');
        await register({ firstName, lastName, email, password });
        setSent(`We emailed a confirmation link to ${email.trim()}. Tap it, then come back and sign in.`);
        setMode('signIn');
      } else {
        await sendPasswordReset(email);
        setSent(`If ${email.trim()} has an account, we emailed a link to choose a new password. It opens the Pickle Spots app.`);
        setMode('signIn');
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <AppHeader />
      <Page maxWidth={460}>
        <View style={{ alignItems: 'center', gap: 12, paddingTop: 24 }}>
          <Logo size={72} />
          <Title style={{ textAlign: 'center' }}>{mode === 'register' ? 'Create Your Account' : mode === 'reset' ? 'Reset Password' : 'Sign In'}</Title>
          <Small style={{ textAlign: 'center' }}>Use your Pickle Spots account. It works in the Pickle Spots app too.</Small>
        </View>
        {mode !== 'reset' ? (
          <View>
            <Segmented
              style={{ alignSelf: 'center' }}
              value={mode}
              onChange={(m) => {
                setMode(m);
                setError(null);
              }}
              options={[
                { value: 'signIn', label: 'Sign In' },
                { value: 'register', label: 'Create Account' },
              ]}
            />
          </View>
        ) : null}
        {sent ? <Banner tone="success" icon="checkCircle">{sent}</Banner> : null}
        <Card style={{ gap: 14 }}>
          {mode === 'register' ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Field style={{ flex: 1 }} label="First Name" value={firstName} onChangeText={setFirstName} autoComplete="given-name" />
              <Field style={{ flex: 1 }} label="Last Name" value={lastName} onChangeText={setLastName} autoComplete="family-name" />
            </View>
          ) : null}
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
          />
          {mode !== 'reset' ? (
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              onSubmitEditing={submit}
            />
          ) : null}
          <ErrorText error={error} />
          <Button title={mode === 'register' ? 'Create Account' : mode === 'reset' ? 'Email Me a Link' : 'Sign In'} onPress={submit} />
          {mode === 'signIn' ? (
            <Button kind="plain" title="Forgot password?" onPress={() => setMode('reset')} />
          ) : mode === 'reset' ? (
            <Button kind="plain" title="Back to sign in" onPress={() => setMode('signIn')} />
          ) : (
            <Body muted style={{ fontSize: 13, textAlign: 'center' }}>
              Other players see your first name and last initial. Club staff see your full name and email.
            </Body>
          )}
        </Card>
      </Page>
    </View>
  );
}
