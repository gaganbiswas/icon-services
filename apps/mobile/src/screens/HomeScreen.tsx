import type { CustomerJob, CustomerProfile } from '@icon/contracts';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Button, ErrorText, Screen, Title, usePalette } from '../components/ui';
import { useSession } from '../session';
import { useLoad } from '../use-load';

export function HomeScreen({
  onOpenJob,
  onNewRequest,
}: {
  onOpenJob: (id: string) => void;
  onNewRequest: () => void;
}) {
  const { api, signOut } = useSession();
  const p = usePalette();
  const [data, reload] = useLoad(
    () => Promise.all([api.me(), api.jobs()]) as Promise<[CustomerProfile, CustomerJob[]]>,
    [api],
  );

  return (
    <Screen>
      <Title>My service requests</Title>
      {data.status === 'ready' ? <Body muted>Signed in as {data.data[0].name}</Body> : null}
      <Button label="New service request" onPress={onNewRequest} />
      {data.status === 'loading' ? <Body muted>Loading…</Body> : null}
      {data.status === 'error' ? (
        <>
          <ErrorText>{data.message}</ErrorText>
          <Button label="Try again" variant="secondary" onPress={reload} />
        </>
      ) : null}
      {data.status === 'ready' && data.data[1].length === 0 ? (
        <Body muted>You have no service requests yet.</Body>
      ) : null}
      {data.status === 'ready'
        ? data.data[1].map((job) => (
            <Pressable
              key={job.id}
              accessibilityRole="button"
              accessibilityLabel={`Request ${job.jobNumber}, ${job.statusLabel}`}
              onPress={() => onOpenJob(job.id)}
              style={[styles.card, { borderColor: p.border }]}
            >
              <Text style={{ color: p.text, fontWeight: '700' }}>{job.jobNumber}</Text>
              <Text style={{ color: p.text }}>
                {job.device.brand} {job.device.model}
              </Text>
              <View style={[styles.status, { borderColor: p.accent }]}>
                <Text style={{ color: p.text }}>{job.statusLabel}</Text>
              </View>
            </Pressable>
          ))
        : null}
      <Button label="Refresh" variant="secondary" onPress={reload} />
      <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 10, padding: 14, gap: 6 },
  status: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
});
