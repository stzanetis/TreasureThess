import React, { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gift, Landmark, MapPinCheck } from 'lucide-react-native';
import { Button, Input, shared } from '../components/ui';
import { useLanguage, useT } from '../lib/i18n';
import { errorMessage, supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

const STEPS = [
  { icon: Landmark, title: 'step1Title', text: 'step1Text' },
  { icon: MapPinCheck, title: 'step2Title', text: 'step2Text' },
  { icon: Gift, title: 'step3Title', text: 'step3Text' },
] as const;

export function AuthScreen() {
  const t = useT();
  const { lang, setLang } = useLanguage();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-up');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: name.trim(), invite_code: invite.trim() } },
        });
        if (error) throw error;
        if (!data.session) {
          Alert.alert(t('checkEmailTitle'), t('checkEmailText'));
          setMode('sign-in');
        }
      }
    } catch (error) {
      Alert.alert(t(mode === 'sign-in' ? 'couldNotSignIn' : 'couldNotSignUp'), errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!email.includes('@')) return Alert.alert(t('enterEmailFirst'));
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: 'https://treasurethess.app/reset-password.html' });
    Alert.alert(error ? t('couldNotSend') : t('emailSent'), error ? errorMessage(error) : t('emailSentText'));
  };

  const valid = email.includes('@') && password.length >= 6 && (mode === 'sign-in' || name.trim().length >= 2);

  return (
    <SafeAreaView style={shared.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable style={styles.language} onPress={() => setLang(lang === 'en' ? 'el' : 'en')} hitSlop={10}>
            <Text style={styles.languageText}>{lang === 'en' ? 'Ελληνικά' : 'English'}</Text>
          </Pressable>
          <Image source={require('../../assets/icon.png')} style={styles.logo} />
          <Text style={[shared.h1, { textAlign: 'center' }]}>TreasureThess</Text>
          <Text style={[shared.body, { textAlign: 'center', marginBottom: 20 }]}>{t('tagline')}</Text>

          {mode === 'sign-up' &&
            STEPS.map(({ icon: Icon, title, text }) => (
              <View key={title} style={styles.step}>
                <View style={styles.stepIcon}><Icon color={colors.primary} size={20} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stepTitle}>{t(title)}</Text>
                  <Text style={styles.stepText}>{t(text)}</Text>
                </View>
              </View>
            ))}

          <View style={{ marginTop: 16 }}>
            {mode === 'sign-up' && <Input placeholder={t('displayName')} value={name} onChangeText={setName} maxLength={30} />}
            <Input placeholder={t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
            <Input placeholder={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} />
            {mode === 'sign-up' && <Input placeholder={t('inviteOptional')} value={invite} onChangeText={setInvite} autoCapitalize="characters" maxLength={6} />}
            <Button title={t(mode === 'sign-in' ? 'signIn' : 'createAccount')} onPress={submit} loading={busy} disabled={!valid} />
          </View>

          <Pressable onPress={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}>
            <Text style={styles.link}>{t(mode === 'sign-in' ? 'toSignUp' : 'toSignIn')}</Text>
          </Pressable>
          {mode === 'sign-in' && (
            <Pressable onPress={resetPassword}>
              <Text style={[styles.link, { color: colors.muted, paddingTop: 0 }]}>{t('forgotPassword')}</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, paddingBottom: 40 },
  language: { alignSelf: 'flex-end', backgroundColor: colors.card, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.line },
  languageText: { fontWeight: '700', color: colors.ink },
  logo: { width: 84, height: 84, borderRadius: 22, alignSelf: 'center', marginBottom: 12, marginTop: 4 },
  step: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 },
  stepIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  stepTitle: { fontWeight: '800', color: colors.ink },
  stepText: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  link: { color: colors.primary, fontWeight: '700', textAlign: 'center', padding: 16 },
});
