import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
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

// "True-black flat": elevation by lightness alone (no borders or shadows on cards), the primary action
// inverted to white, and the one hue (lime) only on data. Every text colour holds 4.5:1 on bg and card.
export const colors = {
  bg: '#000000',
  card: '#111111',
  raised: '#2A2A2A',
  border: '#1A1A1A',
  // inputs and chips need a 3:1 edge against the background (the style's #444 is 2.2:1)
  control: '#666666',
  text: '#FFFFFF',
  muted: '#B4B4B4',
  faint: '#949494',
  accent: '#C6F24E',
  danger: '#E5484D',
  warning: '#E5A93B',
  // status pills: a hue on a dark tint of itself
  pillNeutral: '#222222',
  pillAccent: '#222A10',
  pillWarning: '#2B2414',
  scrim: '#000000CC',
};

// md is the one gap between blocks, lg the phone's side margin
export const space = { xs: 4, sm: 8, md: 14, lg: 20, xl: 32, xxl: 48 };

export const radius = { sm: 4, md: 10, lg: 20, pill: 999 };

/** Loaded in the root layout. A custom font has one family per weight, so styles set fontFamily, never fontWeight. */
export const fonts = {
  display: 'Righteous_400Regular',
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
};

/** One icon set (Ionicons) for the whole app: outline, filled only for the selected tab. */
export type IconName = ComponentProps<typeof Ionicons>['name'];

/** Shared by every Stack navigator. */
export const stackOptions = {
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
  headerTitleStyle: { fontFamily: fonts.semibold },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
};

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  if (!scroll) return <View style={[styles.screen, styles.pad]}>{children}</View>;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

/** The screen's one heading, an optional line about it, and at most the one primary action on its right. */
export function Title({ children, subtitle, right }: { children: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.rowBetween}>
        <Text role="heading" style={styles.title}>
          {children}
        </Text>
        {right}
      </View>
      {subtitle ? <Text style={[styles.body, styles.muted]}>{subtitle}</Text> : null}
    </View>
  );
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={[styles.rowBetween, styles.sectionHeader]}>
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
  icon,
  onPress,
  variant = 'primary',
  small,
  disabled,
  loading,
}: {
  title: string;
  icon?: IconName;
  onPress: () => void;
  variant?: Variant;
  small?: boolean;
  disabled?: boolean;
  loading?: boolean;
}) {
  const textColor = { primary: colors.bg, secondary: colors.text, danger: colors.danger }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      // a small button is 36pt tall: the slop brings its touch area to 44pt
      hitSlop={small ? space.xs : undefined}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={textColor} /> : null}
          <Text style={[styles.buttonText, { color: textColor }, small && { fontSize: 13 }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

/** An icon-only control, 36pt with slop to a 44pt touch area; `label` is what screen readers say. */
export function IconButton({
  icon,
  label,
  onPress,
  disabled,
  color = colors.text,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={space.xs}
      style={({ pressed }) => [styles.iconButton, disabled ? { opacity: 0.3 } : pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={20} color={color} />
    </Pressable>
  );
}

export function Input({ label, ...props }: TextInputProps & { label?: string }) {
  return (
    <View style={{ marginBottom: space.md }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.faint} autoCapitalize="none" style={styles.input} {...props} />
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
    <View style={{ marginBottom: space.md }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.choice}>
        {options.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            hitSlop={space.xs}
            style={[styles.choiceItem, value === o.value && styles.choiceActive]}
          >
            <Text style={[styles.choiceText, value === o.value && { color: colors.text }]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const badgeTones = {
  neutral: { backgroundColor: colors.pillNeutral, color: colors.muted },
  accent: { backgroundColor: colors.pillAccent, color: colors.accent },
  warning: { backgroundColor: colors.pillWarning, color: colors.warning },
};

export function Badge({ text, tone = 'neutral' }: { text: string; tone?: keyof typeof badgeTones }) {
  const { backgroundColor, color } = badgeTones[tone];
  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
}

export function Loading() {
  return <ActivityIndicator style={{ marginTop: space.xl }} color={colors.muted} />;
}

export function Empty({ text }: { text: string }) {
  return <Text style={[styles.body, styles.muted, { textAlign: 'center', marginVertical: space.lg }]}>{text}</Text>;
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
      <View style={{ flex: 1, marginHorizontal: space.md }}>
        <Text numberOfLines={1} style={[styles.body, styles.strong]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={styles.caption}>
          {artist}
        </Text>
      </View>
      {right}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: space.lg, paddingBottom: space.xxl },
  header: { gap: space.xs, marginBottom: space.lg },
  // cards, rows and fields already end on a md margin, so sections land about xl apart
  section: { marginTop: space.lg },
  sectionHeader: { marginBottom: space.md },

  // type scale
  display: { color: colors.accent, fontFamily: fonts.display, fontSize: 34 },
  // Righteous is the wordmark's face only (`display`); screen titles stay in the text face
  title: { color: colors.text, fontFamily: fonts.semibold, fontSize: 24, flexShrink: 1 },
  sectionTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 17 },
  itemTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 16 },
  body: { color: colors.text, fontFamily: fonts.regular, fontSize: 15 },
  // links carry no hue: the accent is for data only
  link: { color: colors.text, fontFamily: fonts.medium, fontSize: 15, textDecorationLine: 'underline' },
  label: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13, marginBottom: space.sm },
  caption: { color: colors.muted, fontFamily: fonts.regular, fontSize: 13 },
  strong: { fontFamily: fonts.semibold },
  muted: { color: colors.muted },

  input: {
    backgroundColor: colors.card,
    color: colors.text,
    fontFamily: fonts.regular,
    borderColor: colors.control,
    borderWidth: 1,
    borderRadius: radius.md,
    minHeight: 44,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 15,
  },
  // the primary is made primary by inversion, never by the accent
  button: {
    backgroundColor: colors.text,
    borderRadius: radius.pill,
    minHeight: 44,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    gap: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: space.xs,
  },
  buttonSmall: { minHeight: 36, paddingVertical: space.xs, paddingHorizontal: space.md, marginVertical: 0 },
  buttonSecondary: { backgroundColor: colors.raised },
  // a destructive action is never the screen's primary: outline only, set apart from what precedes it
  buttonDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger, marginTop: space.lg },
  // shrinks so a long title wraps inside the row instead of overflowing it
  buttonText: { fontFamily: fonts.semibold, fontSize: 15, flexShrink: 1, textAlign: 'center' },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  choice: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  choiceItem: {
    borderWidth: 1,
    borderColor: colors.control,
    borderRadius: radius.pill,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  // selected by a lighter fill and a white edge: white fill is the primary button's alone
  choiceActive: { backgroundColor: colors.raised, borderColor: colors.text },
  choiceText: { color: colors.muted, fontFamily: fonts.medium, fontSize: 13 },
  badge: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  badgeText: { fontFamily: fonts.semibold, fontSize: 12 },
  error: { color: colors.danger, fontFamily: fonts.regular, fontSize: 15, marginVertical: space.sm },
  cover: { borderRadius: radius.sm, backgroundColor: colors.raised },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.md,
    marginBottom: space.sm,
    borderWidth: 1,
    borderColor: colors.card,
  },
});
