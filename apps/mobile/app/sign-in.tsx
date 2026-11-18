import { useRouter } from 'expo-router';

import { SignInScreen } from '../src/screens/SignInScreen';

export default function SignIn() {
  const router = useRouter();
  return <SignInScreen onSignedIn={() => router.replace('/')} />;
}
