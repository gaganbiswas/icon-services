import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SessionProvider } from '../src/session';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
        <Stack>
          <Stack.Screen name="index" options={{ title: 'ICON Service' }} />
          <Stack.Screen name="sign-in" options={{ title: 'Sign in', headerBackVisible: false }} />
          <Stack.Screen name="new-request" options={{ title: 'New request' }} />
          <Stack.Screen name="jobs/[id]" options={{ title: 'Request' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
