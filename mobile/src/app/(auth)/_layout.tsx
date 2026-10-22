import { Stack } from 'expo-router';
import { stackOptions } from '@/components/ui';

export default function AuthLayout() {
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ title: 'Create an account' }} />
      <Stack.Screen name="forgot" options={{ title: 'Forgot password' }} />
    </Stack>
  );
}
