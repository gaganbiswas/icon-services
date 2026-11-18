import { useLocalSearchParams } from 'expo-router';

import { JobDetailScreen } from '../../src/screens/JobDetailScreen';

export default function Job() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <JobDetailScreen id={id} />;
}
