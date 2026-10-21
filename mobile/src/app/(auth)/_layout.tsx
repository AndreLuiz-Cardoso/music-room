import { Stack } from 'expo-router';
import { colors } from '@/components/ui';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="register" options={{ title: 'Create an account' }} />
      <Stack.Screen name="forgot" options={{ title: 'Forgot password' }} />
    </Stack>
  );
}
