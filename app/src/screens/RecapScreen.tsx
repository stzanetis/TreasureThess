import React, { useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Share2 } from 'lucide-react-native';
import { Avatar, Button, Loading, shared } from '../components/ui';
import { collectionProgress, useCollections, useMyProfile, useMyVisits, usePlaces } from '../lib/data';
import { useLanguage, useT } from '../lib/i18n';
import { errorMessage } from '../lib/supabase';
import { colors } from '../lib/theme';

/** A story-sized (9:16) recap of the user's visits, shared as an image. */
export function RecapScreen() {
  const t = useT();
  const { lang } = useLanguage();
  const { width: screenWidth } = useWindowDimensions();
  const card = useRef<View>(null);
  const [sharing, setSharing] = useState(false);
  const profile = useMyProfile();
  const visits = useMyVisits();
  const places = usePlaces();
  const collections = useCollections();

  const visitedIds = useMemo(() => new Set(visits.data?.map((v) => v.place_id)), [visits.data]);

  if (!profile.data || !visits.data || !places.data || !collections.data) return <Loading />;

  const width = Math.min(screenWidth - 48, 380);
  const u = width / 360; // scales every size with the card
  const all = places.data;
  const count = visitedIds.size;
  const percent = all.length ? Math.round((count / all.length) * 100) : 0;
  const progress = collectionProgress(collections.data, all, visitedIds);
  const done = progress.filter((x) => x.total > 0 && x.done === x.total).length;
  const favourite = [...progress].sort((a, b) => b.done - a.done)[0];
  const days = new Set(visits.data.map((v) => new Date(v.created_at).toDateString())).size;
  const nameOf = (placeId?: string) => {
    const place = all.find((p) => p.id === placeId);
    return place ? place[`name_${lang}`] : '–';
  };
  const latest = visits.data[0]?.place_id;
  const first = visits.data[visits.data.length - 1]?.place_id;

  const share = async () => {
    setSharing(true);
    try {
      const uri = await captureRef(card, { format: 'png', quality: 1, width: 1080, height: 1920 });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: t('myThessaloniki') });
    } catch (error) {
      Alert.alert(t('couldNotShare'), errorMessage(error));
    } finally {
      setSharing(false);
    }
  };

  return (
    <ScrollView style={shared.screen} contentContainerStyle={styles.content}>
      <View ref={card} collapsable={false} style={[styles.card, { width, height: (width * 16) / 9, borderRadius: 28 * u, padding: 26 * u }]}>
        <View style={[styles.circle, { width: 260 * u, height: 260 * u, borderRadius: 130 * u, top: -90 * u, right: -90 * u }]} />
        <View style={[styles.circle, { width: 200 * u, height: 200 * u, borderRadius: 100 * u, bottom: -70 * u, left: -80 * u, opacity: 0.12 }]} />

        <Text style={[styles.brand, { fontSize: 12 * u, letterSpacing: 3 * u }]}>TREASURETHESS · {new Date().getFullYear()}</Text>
        <Text style={[styles.title, { fontSize: 34 * u, marginTop: 6 * u }]}>{t('myThessaloniki')}</Text>

        <View style={[shared.row, { gap: 10 * u, marginTop: 16 * u }]}>
          <Avatar url={profile.data.avatar_url} name={profile.data.display_name} size={38 * u} />
          <Text style={[styles.white, { fontSize: 17 * u, fontWeight: '800', flex: 1 }]} numberOfLines={1}>{profile.data.display_name}</Text>
        </View>

        <Text style={[styles.big, { fontSize: 104 * u, lineHeight: 112 * u, marginTop: 18 * u }]}>{count}</Text>
        <Text style={[styles.white, { fontSize: 20 * u, fontWeight: '800' }]}>{t('recapPlaces')}</Text>
        <Text style={[styles.soft, { fontSize: 14 * u, marginTop: 4 * u }]}>{t('recapOf', { total: all.length, percent })}</Text>
        <View style={[styles.bar, { height: 10 * u, borderRadius: 5 * u, marginTop: 12 * u }]}>
          <View style={{ width: `${percent}%`, height: '100%', borderRadius: 5 * u, backgroundColor: colors.gold }} />
        </View>

        <View style={[shared.row, { marginTop: 22 * u }]}>
          {[
            [profile.data.lifetime_points, t('recapPoints')],
            [done, t('recapCollections')],
            [days, t('recapDays')],
          ].map(([value, label]) => (
            <View key={String(label)} style={{ flex: 1 }}>
              <Text style={[styles.white, { fontSize: 28 * u, fontWeight: '900' }]}>{value}</Text>
              <Text style={[styles.soft, { fontSize: 12 * u }]}>{label}</Text>
            </View>
          ))}
        </View>

        <View style={{ flex: 1 }} />

        {count > 0 ? (
          <View style={{ gap: 12 * u }}>
            {favourite && favourite.done > 0 && (
              <Line label={t('recapFavourite')} value={favourite.collection[`name_${lang}`]} color={favourite.collection.color} u={u} />
            )}
            <Line label={t('recapFirst')} value={nameOf(first)} u={u} />
            <Line label={t('recapLatest')} value={nameOf(latest)} u={u} />
          </View>
        ) : (
          <Text style={[styles.white, { fontSize: 22 * u, fontWeight: '800' }]}>{t('recapEmpty')}</Text>
        )}

        <Text style={[styles.footer, { fontSize: 13 * u, marginTop: 22 * u }]}>treasurethess.app</Text>
      </View>

      <Button title={t('share')} icon={<Share2 color="#fff" size={18} />} onPress={share} loading={sharing} style={{ alignSelf: 'stretch', marginTop: 20 }} />
      <Text style={[shared.body, { textAlign: 'center', marginTop: 10 }]}>{t('shareHint')}</Text>
    </ScrollView>
  );
}

function Line({ label, value, color, u }: { label: string; value: string; color?: string; u: number }) {
  return (
    <View style={[shared.row, { gap: 10 * u }]}>
      <View style={{ width: 4 * u, alignSelf: 'stretch', borderRadius: 2 * u, backgroundColor: color ?? colors.gold }} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.soft, { fontSize: 11 * u, letterSpacing: 1 * u }]}>{label.toUpperCase()}</Text>
        <Text style={[styles.white, { fontSize: 17 * u, fontWeight: '800' }]} numberOfLines={1}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, alignItems: 'center' },
  card: { backgroundColor: colors.primaryDark, overflow: 'hidden' },
  circle: { position: 'absolute', backgroundColor: colors.gold, opacity: 0.18 },
  brand: { color: colors.gold, fontWeight: '900' },
  title: { color: '#fff', fontWeight: '900' },
  big: { color: '#fff', fontWeight: '900' },
  white: { color: '#fff' },
  soft: { color: '#c9dccf', fontWeight: '600' },
  bar: { backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  footer: { color: colors.gold, fontWeight: '800', letterSpacing: 1 },
});
