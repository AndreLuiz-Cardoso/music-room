import { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold } from '@expo-google-fonts/poppins';
import { Righteous_400Regular } from '@expo-google-fonts/righteous';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading, colors, stackOptions } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';

function RootStack() {
  const { ready, user } = useAuth();
  // the keys are the family names in `fonts`; on a load error the app falls back to system fonts
  const [fontsLoaded, fontError] = useFonts({
    Righteous_400Regular,
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
  });
  if (!ready || !(fontsLoaded || fontError)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <Loading />
      </View>
    );
  }
  return (
    <Stack screenOptions={stackOptions}>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="event/[id]" options={{ title: 'Event' }} />
        <Stack.Screen name="event/form" options={{ title: 'Event settings' }} />
        <Stack.Screen name="playlist/[id]" options={{ title: 'Playlist' }} />
        <Stack.Screen name="playlist/form" options={{ title: 'Playlist settings' }} />
        <Stack.Screen name="device/[id]" options={{ title: 'Remote control' }} />
        <Stack.Screen name="user/[id]" options={{ title: 'Profile' }} />
      </Stack.Protected>
      {/* a test tool, opened by its address (/server): it does not exist in release builds */}
      <Stack.Protected guard={__DEV__}>
        <Stack.Screen name="server" options={{ title: 'Server address' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        {/* always the phone's format: on a wide screen (web, tablet) the app is a centered column */}
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <View style={{ flex: 1, width: '100%', maxWidth: 400, alignSelf: 'center' }}>
            <RootStack />
          </View>
        </View>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
