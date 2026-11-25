import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { type T, useT } from '../lib/i18n';
import { colors } from '../lib/theme';

type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
};

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style }: ButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonSecondary,
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? '#fff' : colors.primary} />
      ) : (
        <>
          {icon}
          <Text style={[styles.buttonText, { color: isPrimary ? '#fff' : variant === 'danger' ? colors.danger : colors.ink }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.faint} {...props} style={[styles.input, props.multiline && styles.multiline, props.style]} />;
}

export function Avatar({ url, name, size = 40 }: { url?: string | null; name?: string; size?: number }) {
  const style = { width: size, height: size, borderRadius: size / 2 };
  if (url) return <Image source={url} style={style} contentFit="cover" />;
  const initials = (name ?? '?').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  return (
    <View style={[style, styles.avatarFallback]}>
      <Text style={{ color: '#fff', fontWeight: '800', fontSize: size * 0.38 }}>{initials}</Text>
    </View>
  );
}

/** A small coloured label, e.g. a place's collection. */
export function Chip({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}22` }]}>
      <Text style={[styles.badgeText, { color }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => (
        <Pressable key={option.value} onPress={() => onChange(option.value)} style={[styles.segment, value === option.value && styles.segmentActive]}>
          <Text style={[styles.segmentText, value === option.value && styles.segmentTextActive]}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Empty({ icon, title, text }: { icon?: React.ReactNode; title: string; text?: string }) {
  return (
    <View style={styles.empty}>
      {icon}
      <Text style={styles.emptyTitle}>{title}</Text>
      {text ? <Text style={styles.emptyText}>{text}</Text> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primary} size="large" />
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <View style={styles.center}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? <Button title={t('tryAgain')} variant="secondary" onPress={onRetry} style={{ marginTop: 16 }} /> : null}
    </View>
  );
}

export function timeAgo(iso: string, t: T): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return t('justNow');
  if (seconds < 3600) return t('minutesAgo', { n: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('hoursAgo', { n: Math.floor(seconds / 3600) });
  if (seconds < 604800) return t('daysAgo', { n: Math.floor(seconds / 86400) });
  return new Date(iso).toLocaleDateString();
}

export const shared = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: colors.line },
  h1: { fontSize: 28, fontWeight: '800', color: colors.ink },
  h2: { fontSize: 19, fontWeight: '800', color: colors.ink },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: colors.muted, textTransform: 'uppercase' },
  body: { fontSize: 15, lineHeight: 22, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center' },
});

const styles = StyleSheet.create({
  button: { minHeight: 52, borderRadius: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  buttonText: { fontSize: 15, fontWeight: '800' },
  input: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: colors.ink, marginBottom: 10 },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  avatarFallback: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  badge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start', maxWidth: '100%' },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  segmented: { flexDirection: 'row', backgroundColor: '#efe9df', borderRadius: 12, padding: 3 },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.card },
  segmentText: { fontSize: 13, fontWeight: '700', color: colors.muted },
  segmentTextActive: { color: colors.ink },
  empty: { alignItems: 'center', padding: 32, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  emptyText: { fontSize: 14, lineHeight: 20, color: colors.muted, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
  errorText: { color: colors.danger, textAlign: 'center', fontSize: 15, lineHeight: 22 },
});
