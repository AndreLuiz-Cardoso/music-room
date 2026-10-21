import { Tabs } from 'expo-router';
import { Text, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DevicePlayer } from '@/components/DevicePlayer';
import { colors } from '@/components/ui';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <DevicePlayer />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Events', tabBarIcon: icon('♫') }} />
        <Tabs.Screen name="playlists" options={{ title: 'Playlists', tabBarIcon: icon('≡') }} />
        <Tabs.Screen name="devices" options={{ title: 'Devices', tabBarIcon: icon('◉') }} />
        <Tabs.Screen name="friends" options={{ title: 'Friends', tabBarIcon: icon('☺') }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('⚙') }} />
      </Tabs>
    </View>
  );
}
