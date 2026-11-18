import { Redirect, useRouter } from 'expo-router';

import { Body, Screen } from '../src/components/ui';
import { HomeScreen } from '../src/screens/HomeScreen';
import { useSession } from '../src/session';

export default function Index() {
  const { status } = useSession();
  const router = useRouter();
  if (status === 'loading') {
    return (
      <Screen>
        <Body muted>Loading…</Body>
      </Screen>
    );
  }
  if (status === 'signedOut') return <Redirect href="/sign-in" />;
  return (
    <HomeScreen
      onNewRequest={() => router.push('/new-request')}
      onOpenJob={(id) => router.push({ pathname: '/jobs/[id]', params: { id } })}
    />
  );
}
