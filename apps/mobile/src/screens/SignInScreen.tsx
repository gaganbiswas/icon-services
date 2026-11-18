import { useState } from 'react';

import { ApiError, errorMessage } from '../api/client';
import { Body, Button, ErrorText, Field, Screen, Title } from '../components/ui';
import { useSession } from '../session';

type Phase = 'phone' | 'code';

export function SignInScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const { api, markSignedIn } = useSession();
  const [phase, setPhase] = useState<Phase>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      await api.requestCode(phone);
      setPhase('code');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await api.verifyCode(phone, code, needsName ? name : undefined);
      markSignedIn();
      onSignedIn();
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'PROFILE_REQUIRED') {
        setNeedsName(true);
      } else {
        setError(errorMessage(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>Sign in</Title>
      <Body muted>ICON INFOSYS service requests</Body>
      {phase === 'phone' ? (
        <>
          <Field
            label="Mobile number (with country code)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="+91 98123 45678"
          />
          <ErrorText>{error}</ErrorText>
          <Button
            label="Send code"
            onPress={() => void sendCode()}
            busy={busy}
            disabled={phone.trim().length < 6}
          />
        </>
      ) : (
        <>
          <Body>We sent a 6-digit code to {phone}.</Body>
          <Field
            label="6-digit code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
          />
          {needsName ? (
            <>
              <Body>Welcome! Tell us your name to create your account.</Body>
              <Field
                label="Your full name"
                value={name}
                onChangeText={setName}
                autoComplete="name"
              />
            </>
          ) : null}
          <ErrorText>{error}</ErrorText>
          <Button
            label={needsName ? 'Create account' : 'Verify'}
            onPress={() => void verify()}
            busy={busy}
            disabled={!/^\d{6}$/.test(code) || (needsName && name.trim().length === 0)}
          />
          <Button
            label="Use a different number"
            variant="secondary"
            onPress={() => setPhase('phone')}
          />
        </>
      )}
    </Screen>
  );
}
