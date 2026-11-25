import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Award, MapPin, Nfc, X } from 'lucide-react-native';
import { Button, Loading, shared } from '../components/ui';
import { type Place, useCollections, useConfig, useMyVisits, usePlaces } from '../lib/data';
import { useLanguage, useT } from '../lib/i18n';
import { type Coords, distanceMeters, formatDistance, getLocation } from '../lib/location';
import { cancelTagRead, nfcEnabled, nfcSupported, openNfcSettings, readTag } from '../lib/nfc';
import { errorMessage, rpc } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { Nav, RootStackParamList } from '../navigation';

type CheckInResult =
  | { status: 'visited'; place_id: string; points: number; bonus: number; collection_done: number; collection_total: number }
  | { status: 'already_visited' | 'location_required'; place_id: string }
  | { status: 'too_far'; place_id: string; distance: number }
  | { status: 'unknown_tag' };

type State =
  | { step: 'locating' | 'checking' | 'tag' | 'nfc-off' }
  | { step: 'nearby'; me: Coords | null }
  | { step: 'error'; message: string }
  | { step: 'result'; result: CheckInResult };

/** Opened from the centre button (pick a nearby place) or from a place (check in there directly). */
export function CheckInScreen() {
  const t = useT();
  const navigation = useNavigation<Nav>();
  const placeId = useRoute<RouteProp<RootStackParamList, 'CheckIn'>>().params?.placeId;
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>({ step: 'locating' });
  const [hasNfc, setHasNfc] = useState(false);
  const attempt = useRef(0); // a newer action (or leaving) makes older async results stale

  const finish = (result: CheckInResult) => {
    if (result.status === 'visited') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries();
    }
    setState({ step: 'result', result });
  };

  const checkIn = useCallback(async (id: string, me: Coords | null) => {
    const run = ++attempt.current;
    setState({ step: 'checking' });
    try {
      const result = await rpc<CheckInResult>('check_in', { p_place: id, p_lat: me?.latitude ?? null, p_lng: me?.longitude ?? null });
      if (run === attempt.current) finish(result);
    } catch (error) {
      if (run === attempt.current) setState({ step: 'error', message: errorMessage(error) });
    }
  }, []);

  const locate = useCallback(async () => {
    const run = ++attempt.current;
    setState({ step: 'locating' });
    const me = await getLocation(true);
    if (run !== attempt.current) return;
    if (placeId) checkIn(placeId, me);
    else setState({ step: 'nearby', me });
  }, [placeId, checkIn]);

  const scanTag = async () => {
    const run = ++attempt.current;
    if (!(await nfcEnabled())) return setState({ step: 'nfc-off' });
    setState({ step: 'tag' });
    try {
      const uid = await readTag(t('holdTag'));
      if (run !== attempt.current) return;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setState({ step: 'checking' });
      const result = await rpc<CheckInResult>('check_in', { p_uid: uid });
      if (run === attempt.current) finish(result);
    } catch {
      // Leaving the screen cancels the NFC request, which rejects; only report real failures.
      if (run === attempt.current) setState({ step: 'error', message: t('readTagFailed') });
    }
  };

  useEffect(() => {
    nfcSupported().then(setHasNfc);
    locate();
    return () => {
      attempt.current++;
      cancelTagRead();
    };
  }, [locate]);

  const tagButton = hasNfc && !placeId && (
    <Button title={t('scanTag')} variant="secondary" icon={<Nfc color={colors.ink} size={18} />} onPress={scanTag} style={styles.action} />
  );

  return (
    <SafeAreaView style={[shared.screen, styles.container]}>
      <View style={styles.top}>
        <Text style={shared.h2}>{t('checkIn')}</Text>
        <Button title="" variant="secondary" icon={<X color={colors.ink} size={20} />} onPress={() => navigation.goBack()} style={styles.closeButton} />
      </View>

      {state.step === 'nearby' && <Nearby me={state.me} onCheckIn={(id) => checkIn(id, state.me)} onRetry={locate} footer={tagButton} />}
      {state.step === 'result' && <Result result={state.result} />}
      {(state.step === 'locating' || state.step === 'checking') && <Message icon={<MapPin color="#fff" size={40} />} text={t(state.step === 'locating' ? 'locating' : 'checkingIn')} busy />}
      {state.step === 'tag' && <Message icon={<Nfc color="#fff" size={40} />} text={t('holdTag')} busy />}
      {state.step === 'nfc-off' && (
        <Message icon={<Nfc color="#fff" size={40} />} text={t('nfcOff')}>
          <Button title={t('openNfcSettings')} onPress={() => openNfcSettings()} style={styles.action} />
          <Button title={t('tryAgain')} variant="secondary" onPress={scanTag} style={styles.action} />
        </Message>
      )}
      {state.step === 'error' && (
        <Message icon={<X color="#fff" size={40} />} text={state.message}>
          <Button title={t('tryAgain')} variant="secondary" onPress={locate} style={styles.action} />
          {tagButton}
        </Message>
      )}
    </SafeAreaView>
  );
}

function Message({ icon, text, busy, children }: { icon: React.ReactNode; text: string; busy?: boolean; children?: React.ReactNode }) {
  return (
    <View style={styles.center}>
      <View style={styles.icon}>{icon}</View>
      <Text style={[shared.body, styles.text]}>{text}</Text>
      {busy && <View style={{ height: 60 }}><Loading /></View>}
      {children}
    </View>
  );
}

function Nearby({ me, onCheckIn, onRetry, footer }: { me: Coords | null; onCheckIn: (id: string) => void; onRetry: () => void; footer: React.ReactNode }) {
  const t = useT();
  const { lang } = useLanguage();
  const navigation = useNavigation<Nav>();
  const places = usePlaces().data ?? [];
  const visits = useMyVisits().data ?? [];
  const radius = useConfig().data?.checkin_radius_m ?? 100;

  if (!me) {
    return (
      <Message icon={<MapPin color="#fff" size={40} />} text={t('locationOff')}>
        <Button title={t('tryAgain')} onPress={onRetry} style={styles.action} />
        {footer}
      </Message>
    );
  }

  const visited = new Set(visits.map((v) => v.place_id));
  const byDistance = places
    .filter((p) => !visited.has(p.id))
    .map((place) => ({ place, distance: distanceMeters(me, place) }))
    .sort((a, b) => a.distance - b.distance);
  const inRange = byDistance.filter((x) => x.distance <= radius);
  const nearest = byDistance[0];

  if (!inRange.length) {
    return (
      <Message icon={<MapPin color="#fff" size={40} />} text={`${t('noneNearby', { radius })}${nearest ? `\n${t('nearest', { name: nearest.place[`name_${lang}`], distance: formatDistance(nearest.distance) })}` : ''}`}>
        {nearest && <Button title={t('showMeTheWay')} onPress={() => navigation.replace('Place', { id: nearest.place.id })} style={styles.action} />}
        <Button title={t('tryAgain')} variant="secondary" onPress={onRetry} style={styles.action} />
        {footer}
      </Message>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 16 }}>
      <Text style={[shared.label, { marginBottom: 10 }]}>{t('nearYou')}</Text>
      {inRange.map(({ place, distance }) => (
        <View key={place.id} style={[shared.card, styles.nearby]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.nearbyName}>{place[`name_${lang}`]}</Text>
            <Text style={styles.nearbyMeta}>{formatDistance(distance)}</Text>
          </View>
          <Button title={t('checkInFor', { n: place.points })} onPress={() => onCheckIn(place.id)} />
        </View>
      ))}
      {footer}
    </ScrollView>
  );
}

function Result({ result }: { result: CheckInResult }) {
  const t = useT();
  const { lang } = useLanguage();
  const navigation = useNavigation<Nav>();
  const places = usePlaces().data ?? [];
  const collections = useCollections().data ?? [];
  const pop = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  }, [pop]);

  const place: Place | undefined = 'place_id' in result ? places.find((p) => p.id === result.place_id) : undefined;
  const name = place ? place[`name_${lang}`] : '';
  const collection = collections.find((c) => c.id === place?.collection_id);
  const collectionName = collection ? collection[`name_${lang}`] : '';
  const radius = useConfig().data?.checkin_radius_m ?? 100;

  let title = name;
  let lines: string[] = [];
  switch (result.status) {
    case 'visited':
      lines = [t('checkedIn'), t('collectionProgress', { done: result.collection_done, total: result.collection_total, collection: collectionName })];
      if (result.bonus) lines.push(t('collectionComplete', { collection: collectionName, n: result.bonus }));
      break;
    case 'already_visited':
      lines = [t('alreadyVisited'), t('alreadyVisitedText')];
      break;
    case 'too_far':
      title = t('tooFar');
      lines = [t('tooFarText', { distance: formatDistance(result.distance), name, radius })];
      break;
    case 'location_required':
      lines = [t('locationOff')];
      break;
    case 'unknown_tag':
      title = t('unknownTag');
      lines = [t('unknownTagText')];
      break;
  }
  const success = result.status === 'visited';

  return (
    <View style={styles.center}>
      <Animated.View style={[styles.icon, { backgroundColor: success ? colors.gold : colors.primary, transform: [{ scale: pop }] }]}>
        {success ? <Award color="#fff" size={44} /> : <MapPin color="#fff" size={40} />}
      </Animated.View>
      <Text style={[shared.h1, styles.title]}>{title}</Text>
      {success && <Text style={styles.points}>{t('plusPoints', { n: result.points + result.bonus })}</Text>}
      {lines.map((line) => <Text key={line} style={[shared.body, styles.text]}>{line}</Text>)}
      <View style={{ height: 12 }} />
      {success && place && <Button title={t('ratePlace')} onPress={() => navigation.replace('Place', { id: place.id })} style={styles.action} />}
      {result.status === 'too_far' && place && <Button title={t('showMeTheWay')} onPress={() => navigation.replace('Place', { id: place.id })} style={styles.action} />}
      <Button title={t('done')} variant="secondary" onPress={() => navigation.goBack()} style={styles.action} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  closeButton: { width: 48, minHeight: 48, paddingHorizontal: 0, borderRadius: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 },
  icon: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  title: { textAlign: 'center', marginTop: 16 },
  points: { fontSize: 24, fontWeight: '900', color: colors.gold, marginTop: 6 },
  text: { textAlign: 'center', marginTop: 10 },
  action: { alignSelf: 'stretch', marginTop: 10 },
  nearby: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  nearbyName: { fontWeight: '800', fontSize: 16, color: colors.ink },
  nearbyMeta: { color: colors.muted, marginTop: 2 },
});
