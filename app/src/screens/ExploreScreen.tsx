import React, { useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Navigation, Star } from 'lucide-react-native';
import { PlaceMap } from '../components/PlaceMap';
import { Button, Chip, ErrorView, Loading, Segmented, shared } from '../components/ui';
import { type Place, useCollections, useConfig, useMyProfile, useMyVisits, usePlaces } from '../lib/data';
import { useLanguage, useT } from '../lib/i18n';
import { type Coords, distanceMeters, formatDistance, useWatchedLocation } from '../lib/location';
import { errorMessage } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { Nav } from '../navigation';

export function openDirections(place: Place) {
  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}&travelmode=walking`);
}

export function ExploreScreen() {
  const t = useT();
  const navigation = useNavigation<Nav>();
  const me = useWatchedLocation(useIsFocused());
  const profile = useMyProfile();
  const places = usePlaces();
  const collections = useCollections();
  const visits = useMyVisits();
  const [view, setView] = useState<'map' | 'list'>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visitedIds = useMemo(() => new Set(visits.data?.map((v) => v.place_id)), [visits.data]);
  const colorById = useMemo(() => new Map(collections.data?.map((c) => [c.id, c.color])), [collections.data]);
  const colorOf = (place: Place) => colorById.get(place.collection_id) ?? colors.primary;

  if (places.isLoading) return <Loading />;
  if (places.error) return <ErrorView message={errorMessage(places.error)} onRetry={places.refetch} />;

  const all = places.data ?? [];
  const selected = all.find((p) => p.id === selectedId);
  const sorted = me ? [...all].sort((a, b) => distanceMeters(me, a) - distanceMeters(me, b)) : all;

  return (
    <SafeAreaView style={shared.screen} edges={['top']}>
      <View style={styles.header}>
        <View style={[shared.row, { justifyContent: 'space-between' }]}>
          <View>
            <Text style={styles.brand}>TreasureThess</Text>
            <Text style={styles.progress}>{t('placesProgress', { done: visitedIds.size, total: all.length })}</Text>
          </View>
          <Pressable style={styles.points} onPress={() => navigation.navigate('Tabs', { screen: 'Rewards' })}>
            <Star color={colors.gold} size={16} fill={colors.gold} />
            <Text style={styles.pointsText}>{profile.data?.points ?? '–'}</Text>
          </Pressable>
        </View>
        <Segmented value={view} onChange={setView} options={[{ value: 'map', label: t('map') }, { value: 'list', label: t('list') }]} />
      </View>

      {view === 'map' ? (
        <View style={{ flex: 1 }}>
          <PlaceMap places={all} colorOf={colorOf} visitedIds={visitedIds} me={me} selectedId={selectedId} onSelect={setSelectedId} />
          {selected && (
            <PreviewCard place={selected} color={colorOf(selected)} visited={visitedIds.has(selected.id)} me={me} onClose={() => setSelectedId(null)} />
          )}
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <PlaceRow place={item} color={colorOf(item)} visited={visitedIds.has(item.id)} me={me} onPress={() => navigation.navigate('Place', { id: item.id })} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function PlaceRow({ place, color, visited, me, onPress }: { place: Place; color: string; visited: boolean; me: Coords | null; onPress: () => void }) {
  const t = useT();
  const { lang } = useLanguage();
  return (
    <Pressable style={[shared.card, styles.row]} onPress={onPress}>
      <View style={[styles.dot, { backgroundColor: color }]}>{visited && <Check color="#fff" size={16} strokeWidth={3} />}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{place[`name_${lang}`]}</Text>
        <Text style={styles.rowMeta}>
          {me ? t('away', { distance: formatDistance(distanceMeters(me, place)) }) : ''}
        </Text>
      </View>
      <Text style={[styles.rowPoints, visited && { color: colors.faint }]}>{visited ? t('visited') : `+${place.points}`}</Text>
    </Pressable>
  );
}

function PreviewCard({ place, color, visited, me, onClose }: { place: Place; color: string; visited: boolean; me: Coords | null; onClose: () => void }) {
  const t = useT();
  const { lang } = useLanguage();
  const navigation = useNavigation<Nav>();
  const collections = useCollections();
  const radius = useConfig().data?.checkin_radius_m ?? 100;
  const collection = collections.data?.find((c) => c.id === place.collection_id);
  const distance = me ? distanceMeters(me, place) : null;
  const canCheckIn = !visited && distance !== null && distance <= radius;

  return (
    <View style={styles.card}>
      <View style={[shared.row, { justifyContent: 'space-between', marginBottom: 6, gap: 8 }]}>
        {collection ? <Chip label={collection[`name_${lang}`]} color={color} /> : <View />}
        <Pressable onPress={onClose} hitSlop={12}><Text style={styles.close}>{t('close')}</Text></Pressable>
      </View>
      <Pressable onPress={() => navigation.navigate('Place', { id: place.id })}>
        <Text style={shared.h2} numberOfLines={1}>{place[`name_${lang}`]}</Text>
        <Text style={[shared.body, { marginTop: 2 }]}>
          {visited ? `✓ ${t('visited')}` : t('plusPoints', { n: place.points })}
          {distance !== null ? `  ·  ${t('away', { distance: formatDistance(distance) })}` : ''}
        </Text>
      </Pressable>
      <View style={[shared.row, { gap: 10, marginTop: 14 }]}>
        <Button title={t('directions')} variant="secondary" icon={<Navigation color={colors.ink} size={16} />} onPress={() => openDirections(place)} style={{ flex: 1 }} />
        {canCheckIn ? (
          <Button title={t('checkInFor', { n: place.points })} onPress={() => navigation.navigate('CheckIn', { placeId: place.id })} style={{ flex: 1 }} />
        ) : (
          <Button title={t('details')} onPress={() => navigation.navigate('Place', { id: place.id })} style={{ flex: 1 }} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, gap: 10 },
  brand: { fontSize: 22, fontWeight: '900', color: colors.primaryDark },
  progress: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  points: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: colors.line },
  pointsText: { fontWeight: '900', fontSize: 16, color: colors.ink },
  card: { position: 'absolute', left: 12, right: 12, bottom: 12, backgroundColor: colors.card, borderRadius: 22, padding: 16, elevation: 8 },
  close: { color: colors.muted, fontWeight: '700' },
  list: { padding: 16, paddingTop: 4, paddingBottom: 40, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  dot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontWeight: '800', fontSize: 15, color: colors.ink },
  rowMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  rowPoints: { fontWeight: '900', color: colors.primary },
});
