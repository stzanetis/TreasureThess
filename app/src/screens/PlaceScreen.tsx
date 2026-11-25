import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Landmark, Navigation, Star } from 'lucide-react-native';
import { Avatar, Button, Chip, Empty, ErrorView, Input, Loading, shared, timeAgo } from '../components/ui';
import { type PersonRef, useCollections, useMyVisits, usePlaces, useSession } from '../lib/data';
import { useLanguage, useT } from '../lib/i18n';
import { errorMessage, supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { Nav, RootStackParamList } from '../navigation';
import { openDirections } from './ExploreScreen';

type Review = { id: string; rating: number; body: string | null; created_at: string; user: PersonRef };

export function PlaceScreen() {
  const t = useT();
  const { lang } = useLanguage();
  const { id } = useRoute<RouteProp<RootStackParamList, 'Place'>>().params;
  const navigation = useNavigation<Nav>();
  const me = useSession().user.id;
  const places = usePlaces();
  const collections = useCollections();
  const visit = useMyVisits().data?.find((v) => v.place_id === id);

  const visitors = useQuery({
    queryKey: ['visitors', id],
    queryFn: async () => {
      const { count, error } = await supabase.from('visits').select('*', { count: 'exact', head: true }).eq('place_id', id);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const reviews = useQuery({
    queryKey: ['reviews', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('place_reviews')
        .select('id, rating, body, created_at, user:profiles(id, display_name, avatar_url)')
        .eq('place_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as Review[];
    },
  });

  if (places.isLoading) return <Loading />;
  const place = places.data?.find((p) => p.id === id);
  if (!place) return <ErrorView message={errorMessage(places.error)} onRetry={places.refetch} />;

  const collection = collections.data?.find((c) => c.id === place.collection_id);
  const color = collection?.color ?? colors.primary;
  const reviewed = reviews.data?.some((r) => r.user.id === me);
  const average = reviews.data?.length ? reviews.data.reduce((sum, r) => sum + r.rating, 0) / reviews.data.length : null;

  return (
    <KeyboardAvoidingView style={shared.screen} behavior="padding">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {place.image_url ? (
          <Image source={place.image_url} style={styles.image} contentFit="cover" />
        ) : (
          <View style={[styles.image, styles.placeholder, { backgroundColor: color }]}><Landmark color="#fff" size={56} /></View>
        )}

        <View style={[shared.row, { gap: 8, marginTop: 16, flexWrap: 'wrap' }]}>
          {collection && <Chip label={collection[`name_${lang}`]} color={color} />}
          <Chip label={visit ? `✓ ${t('visited')}` : t('plusPoints', { n: place.points })} color={visit ? colors.primary : colors.gold} />
        </View>
        <Text style={[shared.h1, { marginTop: 10 }]}>{place[`name_${lang}`]}</Text>
        <Text style={styles.meta}>
          {t('visitors', { n: visitors.data ?? 0 })}
          {average ? `  ·  ★ ${average.toFixed(1)}` : ''}
        </Text>
        {visit && <Text style={styles.meta}>{t('visitedOn', { date: new Date(visit.created_at).toLocaleDateString() })}</Text>}
        {place[`description_${lang}`] ? <Text style={[shared.body, { marginTop: 12 }]}>{place[`description_${lang}`]}</Text> : null}

        <View style={[shared.row, { gap: 10, marginTop: 18 }]}>
          <Button title={t('directions')} variant="secondary" icon={<Navigation color={colors.ink} size={16} />} onPress={() => openDirections(place)} style={{ flex: 1 }} />
          {!visit && <Button title={t('checkIn')} onPress={() => navigation.navigate('CheckIn', { placeId: place.id })} style={{ flex: 1 }} />}
        </View>

        {visit && !reviewed && <ReviewForm placeId={place.id} />}

        <Text style={[shared.h2, { marginTop: 28, marginBottom: 8 }]}>{t('reviews')}</Text>
        {reviews.data?.length ? (
          reviews.data.map((r) => (
            <Pressable key={r.id} style={[shared.card, styles.review]} onPress={() => navigation.push('Profile', { userId: r.user.id })}>
              <View style={[shared.row, { gap: 10 }]}>
                <Avatar url={r.user.avatar_url} name={r.user.display_name} size={30} />
                <Text style={styles.reviewName} numberOfLines={1}>{r.user.display_name}</Text>
                <Text style={styles.stars}>{'★'.repeat(r.rating)}</Text>
                <Text style={styles.time}>{timeAgo(r.created_at, t)}</Text>
              </View>
              {r.body ? <Text style={[shared.body, { marginTop: 8 }]}>{r.body}</Text> : null}
            </Pressable>
          ))
        ) : (
          <Empty title={t('noReviews')} text={visit ? undefined : t('noReviewsText')} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ReviewForm({ placeId }: { placeId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    const { error } = await supabase.from('place_reviews').insert({ place_id: placeId, rating, body: body.trim() || null });
    setSaving(false);
    if (error) return Alert.alert(t('couldNotPost'), errorMessage(error));
    queryClient.invalidateQueries({ queryKey: ['reviews', placeId] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  return (
    <View style={[shared.card, { marginTop: 20 }]}>
      <Text style={shared.h2}>{t('reviewTitle')}</Text>
      <View style={[shared.row, { gap: 6, marginVertical: 12 }]}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}>
            <Star size={32} color={colors.gold} fill={n <= rating ? colors.gold : 'transparent'} />
          </Pressable>
        ))}
      </View>
      <Input placeholder={t('reviewPlaceholder')} value={body} onChangeText={setBody} multiline maxLength={500} />
      <Button title={t('postReview')} onPress={submit} loading={saving} disabled={!rating} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  image: { width: '100%', height: 200, borderRadius: 20 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  meta: { color: colors.muted, marginTop: 4 },
  review: { marginBottom: 8 },
  reviewName: { fontWeight: '800', color: colors.ink, flex: 1 },
  stars: { color: colors.gold },
  time: { color: colors.faint, fontSize: 12 },
});
