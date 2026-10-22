import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DevicePlayer } from '@/components/DevicePlayer';
import { colors, fonts, type IconName } from '@/components/ui';

// the selected tab is told apart by shape (filled icon) as well as brightness, not by colour alone
const icon = (selected: IconName, idle: IconName) =>
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    // the tints passed in are the strings set in screenOptions below
    return <Ionicons name={focused ? selected : idle} size={20} color={color as string} />;
  };

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <DevicePlayer />
      <Tabs
        screenOptions={{
          headerShown: false,
          // one ground for page and bar; the active tab brightens, the accent never touches nav
          tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.muted,
          // the tab bar is a fixed 49pt: Poppins' tall natural line box overflows it unless pinned
          tabBarLabelStyle: { fontFamily: fonts.medium, lineHeight: 12 },
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Events', tabBarIcon: icon('musical-notes', 'musical-notes-outline') }} />
        <Tabs.Screen name="playlists" options={{ title: 'Playlists', tabBarIcon: icon('list', 'list-outline') }} />
        <Tabs.Screen name="devices" options={{ title: 'Devices', tabBarIcon: icon('phone-portrait', 'phone-portrait-outline') }} />
        <Tabs.Screen name="friends" options={{ title: 'Friends', tabBarIcon: icon('people', 'people-outline') }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-circle', 'person-circle-outline') }} />
      </Tabs>
    </View>
  );
}
