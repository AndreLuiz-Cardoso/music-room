import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

export const colors = {
  bg: '#121212',
  card: '#1e1e1e',
  border: '#2c2c2c',
  text: '#f2f2f2',
  muted: '#9a9a9a',
  accent: '#1db954',
  danger: '#e5484d',
  warning: '#f5a623',
};

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={[styles.screen, styles.pad]}>{children}</View>;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.rowBetween}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[styles.body, muted && styles.muted, style]}>{children}</Text>;
}

type Variant = 'primary' | 'secondary' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  small,
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  small?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Text style={[styles.buttonText, small && { fontSize: 13 }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Input({ label, ...props }: TextInputProps & { label?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.muted} autoCapitalize="none" style={styles.input} {...props} />
    </View>
  );
}

export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: ViewStyle }) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, style, pressed && { opacity: 0.7 }]}>
      {children}
    </Pressable>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.choice}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            style={[styles.choiceItem, value === o.value && styles.choiceActive]}
          >
            <Text style={[styles.choiceText, value === o.value && { color: colors.bg }]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function Badge({ text, color = colors.muted }: { text: string; color?: string }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={{ color, fontSize: 11, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
}

export function Loading() {
  return <ActivityIndicator style={{ marginTop: 32 }} color={colors.accent} />;
}

export function Empty({ text }: { text: string }) {
  return <Text style={[styles.body, styles.muted, { textAlign: 'center', marginVertical: 16 }]}>{text}</Text>;
}

export function Cover({ uri, size = 44 }: { uri: string | null; size?: number }) {
  if (!uri) return <View style={[styles.cover, { width: size, height: size }]} />;
  return <Image source={{ uri }} style={[styles.cover, { width: size, height: size }]} />;
}

export function TrackLine({
  title,
  artist,
  coverUrl,
  right,
  highlight,
}: {
  title: string;
  artist: string;
  coverUrl: string | null;
  right?: ReactNode;
  highlight?: boolean;
}) {
  return (
    <View style={[styles.track, highlight && { borderColor: colors.accent }]}>
      <Cover uri={coverUrl} />
      <View style={{ flex: 1, marginHorizontal: 10 }}>
        <Text numberOfLines={1} style={[styles.body, { fontWeight: '600' }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.body, styles.muted, { fontSize: 13 }]}>
          {artist}
        </Text>
      </View>
      {right}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16, paddingBottom: 48 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700', marginBottom: 12 },
  section: { marginTop: 20 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  body: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted },
  label: { color: colors.muted, fontSize: 13, marginBottom: 4 },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  button: {
    backgroundColor: colors.accent,
    borderRadius: 24,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    marginVertical: 4,
  },
  buttonSmall: { paddingVertical: 6, paddingHorizontal: 12, marginVertical: 0 },
  buttonSecondary: { backgroundColor: colors.border },
  buttonDanger: { backgroundColor: colors.danger },
  buttonText: { color: colors.text, fontWeight: '700', fontSize: 15 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  choice: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choiceItem: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  choiceActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  choiceText: { color: colors.text, fontSize: 13 },
  badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  error: { color: colors.danger, marginVertical: 8 },
  cover: { borderRadius: 4, backgroundColor: colors.border },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: colors.card,
  },
});
