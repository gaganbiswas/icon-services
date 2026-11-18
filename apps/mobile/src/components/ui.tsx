import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  useColorScheme,
} from 'react-native';

export function usePalette() {
  const dark = useColorScheme() === 'dark';
  return {
    bg: dark ? '#121417' : '#ffffff',
    text: dark ? '#eceef1' : '#1a1d21',
    muted: dark ? '#a5adb6' : '#555d66',
    border: dark ? '#3b4149' : '#c4c9cf',
    accent: dark ? '#60a5fa' : '#1d4ed8',
    accentText: dark ? '#0b1220' : '#ffffff',
    danger: dark ? '#f97066' : '#b42318',
  };
}

export function Screen({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <ScrollView
      style={{ backgroundColor: p.bg }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <Text accessibilityRole="header" style={[styles.title, { color: p.text }]}>
      {children}
    </Text>
  );
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const p = usePalette();
  return <Text style={{ color: muted ? p.muted : p.text, fontSize: 15 }}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  const p = usePalette();
  if (!children) return null;
  return (
    <Text accessibilityRole="alert" style={{ color: p.danger, fontSize: 15 }}>
      ⚠ {children}
    </Text>
  );
}

export function Field({
  label,
  error,
  ...input
}: TextInputProps & { label: string; error?: string | undefined }) {
  const p = usePalette();
  return (
    <View style={styles.field}>
      <Text style={{ color: p.text, fontWeight: '600' }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={p.muted}
        style={[styles.input, { color: p.text, borderColor: error ? p.danger : p.border }]}
        {...input}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  disabled = false,
  busy = false,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const p = usePalette();
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary ? p.accent : 'transparent',
          borderColor: primary ? p.accent : p.border,
          opacity: disabled || busy ? 0.6 : pressed ? 0.85 : 1,
        },
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? p.accentText : p.text} /> : null}
      <Text style={{ color: primary ? p.accentText : p.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

/** Single-choice list of options rendered as radio buttons. */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  const p = usePalette();
  return (
    <View style={styles.field} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={{ color: p.text, fontWeight: '600' }}>{label}</Text>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(o.value)}
            style={[
              styles.option,
              { borderColor: selected ? p.accent : p.border, borderWidth: selected ? 2 : 1 },
            ]}
          >
            <Text style={{ color: p.text }}>
              {selected ? '◉ ' : '○ '}
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 14 },
  title: { fontSize: 22, fontWeight: '700' },
  field: { gap: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    minHeight: 48,
  },
  button: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
  },
  option: { borderRadius: 8, padding: 12, minHeight: 48, justifyContent: 'center' },
});
