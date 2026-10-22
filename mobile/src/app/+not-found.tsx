import { Redirect, Stack } from 'expo-router';
import { Empty, Screen } from '@/components/ui';
import { useAuth } from '@/lib/auth';

export default function NotFound() {
  const { user } = useAuth();
  // Logged out, protected screens aren't registered: their URLs land here and go to login.
  if (!user) return <Redirect href="/login" />;
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Empty text="This page does not exist." />
    </Screen>
  );
}
