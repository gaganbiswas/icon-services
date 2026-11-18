import { useRouter } from 'expo-router';

import { NewRequestScreen } from '../src/screens/NewRequestScreen';

export default function NewRequest() {
  const router = useRouter();
  return (
    <NewRequestScreen
      onSubmitted={(job) => router.replace({ pathname: '/jobs/[id]', params: { id: job.id } })}
    />
  );
}
