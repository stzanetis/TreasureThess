import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, ChevronRight } from 'lucide-react-native';
import { Avatar, Button, Input, Segmented, shared } from '../components/ui';
import { useMyProfile, useSession } from '../lib/data';
import { type StringKey, useLanguage, useT } from '../lib/i18n';
import { pickImage, uploadAvatar } from '../lib/images';
import { errorMessage, rpc, supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

const LINKS: { label: StringKey; url: string }[] = [
  { label: 'howItWorks', url: 'https://treasurethess.app/#how' },
  { label: 'privacy', url: 'https://treasurethess.app/privacy.html' },
  { label: 'terms', url: 'https://treasurethess.app/terms.html' },
  { label: 'contact', url: 'mailto:hello@treasurethess.app' },
];

export function SettingsScreen() {
  const t = useT();
  const { lang, setLang } = useLanguage();
  const session = useSession();
  const profile = useMyProfile();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile.data) {
      setName(profile.data.display_name);
      setBio(profile.data.bio ?? '');
    }
  }, [profile.data]);

  const update = async (changes: { display_name?: string; bio?: string | null; avatar_url?: string }) => {
    const { error } = await supabase.from('profiles').update(changes).eq('id', session.user.id);
    if (error) throw error;
    queryClient.invalidateQueries();
  };

  const save = async () => {
    setSaving(true);
    try {
      await update({ display_name: name.trim(), bio: bio.trim() || null });
      Alert.alert(t('saved'));
    } catch (error) {
      Alert.alert(t('couldNotSave'), errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const changeAvatar = async () => {
    const uri = await pickImage(t);
    if (!uri) return;
    try {
      await update({ avatar_url: await uploadAvatar(session.user.id, uri) });
    } catch (error) {
      Alert.alert(t('couldNotUpload'), errorMessage(error));
    }
  };

  const deleteAccount = () =>
    Alert.alert(t('deleteTitle'), t('deleteText'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('deleteForever'),
        style: 'destructive',
        onPress: async () => {
          try {
            await rpc('delete_my_account');
            await supabase.auth.signOut();
          } catch (error) {
            Alert.alert(t('couldNotDelete'), errorMessage(error));
          }
        },
      },
    ]);

  return (
    <KeyboardAvoidingView style={shared.screen} behavior="padding">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.avatar} onPress={changeAvatar}>
          <Avatar url={profile.data?.avatar_url} name={profile.data?.display_name} size={96} />
          <View style={styles.camera}><Camera color="#fff" size={16} /></View>
        </Pressable>

        <Text style={[shared.label, styles.label]}>{t('displayName')}</Text>
        <Input value={name} onChangeText={setName} maxLength={30} />
        <Text style={[shared.label, styles.label]}>{t('bio')}</Text>
        <Input value={bio} onChangeText={setBio} maxLength={160} multiline placeholder={t('bioPlaceholder')} />
        <Button title={t('saveProfile')} onPress={save} loading={saving} disabled={name.trim().length < 2} />

        <Text style={[shared.label, styles.label, { marginTop: 24 }]}>{t('language')}</Text>
        <Segmented value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'el', label: 'Ελληνικά' }]} />

        <View style={[shared.card, styles.links]}>
          {LINKS.map((link) => (
            <Pressable key={link.label} style={styles.link} onPress={() => Linking.openURL(link.url)}>
              <Text style={styles.linkText}>{t(link.label)}</Text>
              <ChevronRight color={colors.faint} size={18} />
            </Pressable>
          ))}
        </View>

        <Text style={styles.email}>{t('signedInAs', { email: session.user.email ?? '' })}</Text>
        <Button title={t('signOut')} variant="secondary" onPress={() => supabase.auth.signOut()} />
        <Button title={t('deleteAccount')} variant="danger" onPress={deleteAccount} style={{ marginTop: 10 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  avatar: { alignSelf: 'center', marginBottom: 12 },
  camera: { position: 'absolute', right: 0, bottom: 0, backgroundColor: colors.primary, borderRadius: 14, width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg },
  label: { marginBottom: 6, marginTop: 6 },
  links: { marginTop: 24, paddingVertical: 4 },
  link: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  linkText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  email: { color: colors.muted, textAlign: 'center', marginVertical: 16 },
});
