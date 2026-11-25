import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Award, ChevronRight, Compass, Crown, Footprints, Gift, Lock, Map as MapIcon, MessageSquare, Settings, Share2, Sparkles, Trophy, Users } from 'lucide-react-native';
import { Avatar, Button, Empty, ErrorView, Loading, shared } from '../components/ui';
import { collectionProgress, type ProfileStats, useCollections, usePlaces, useProfile, useProfileStats, useSession, useVisits } from '../lib/data';
import { type StringKey, useLanguage, useT } from '../lib/i18n';
import { errorMessage, supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { Nav, RootStackParamList } from '../navigation';

type BadgeFacts = ProfileStats & { places: number; totalPlaces: number; collectionsDone: number; totalCollections: number };

const BADGES: { key: StringKey; detail: StringKey; icon: typeof Award; earned: (f: BadgeFacts) => boolean }[] = [
  { key: 'badgeFirst', detail: 'badgeFirstDetail', icon: Footprints, earned: (f) => f.places >= 1 },
  { key: 'badgeExplorer', detail: 'badgeExplorerDetail', icon: Compass, earned: (f) => f.places >= 5 },
  { key: 'badgeExpert', detail: 'badgeExpertDetail', icon: MapIcon, earned: (f) => f.places >= 15 },
  { key: 'badgeAll', detail: 'badgeAllDetail', icon: Crown, earned: (f) => f.totalPlaces > 0 && f.places >= f.totalPlaces },
  { key: 'badgeCollector', detail: 'badgeCollectorDetail', icon: Award, earned: (f) => f.collectionsDone >= 1 },
  { key: 'badgeGrand', detail: 'badgeGrandDetail', icon: Trophy, earned: (f) => f.totalCollections > 0 && f.collectionsDone >= f.totalCollections },
  { key: 'badgeCritic', detail: 'badgeCriticDetail', icon: MessageSquare, earned: (f) => f.reviews >= 3 },
  { key: 'badgeTreat', detail: 'badgeTreatDetail', icon: Gift, earned: (f) => f.coupons >= 1 },
  { key: 'badgePopular', detail: 'badgePopularDetail', icon: Users, earned: (f) => f.followers >= 5 },
];

/** The "Me" tab. */
export function MyProfileScreen() {
  return <ProfileView userId={useSession().user.id} />;
}

/** Someone else's profile, opened from the feed, leaderboard, search or a review. */
export function ProfileScreen() {
  const { userId } = useRoute<RouteProp<RootStackParamList, 'Profile'>>().params;
  return <ProfileView userId={userId} />;
}

function ProfileView({ userId }: { userId: string }) {
  const t = useT();
  const { lang } = useLanguage();
  const navigation = useNavigation<Nav>();
  const me = useSession().user.id;
  const isMe = userId === me;
  const queryClient = useQueryClient();
  const profile = useProfile(userId);
  const stats = useProfileStats(userId);
  const visits = useVisits(userId);
  const places = usePlaces();
  const collections = useCollections();
  const [following, setFollowing] = useState(false);

  const visitedIds = useMemo(() => new Set(visits.data?.map((v) => v.place_id)), [visits.data]);
  const progress = collectionProgress(collections.data ?? [], places.data ?? [], visitedIds);

  if (profile.isLoading || stats.isLoading) return <Loading />;
  if (profile.error || !profile.data) return <ErrorView message={errorMessage(profile.error)} onRetry={profile.refetch} />;

  const p = profile.data;
  const s = stats.data;
  const collectionsDone = progress.filter((x) => x.total > 0 && x.done === x.total).length;
  const facts: BadgeFacts | null = s
    ? { ...s, places: visitedIds.size, totalPlaces: places.data?.length ?? 0, collectionsDone, totalCollections: progress.length }
    : null;
  const placeById = new Map(places.data?.map((place) => [place.id, place]));

  const toggleFollow = async () => {
    setFollowing(true);
    const { error } = s?.is_following
      ? await supabase.from('follows').delete().eq('follower_id', me).eq('followee_id', userId)
      : await supabase.from('follows').insert({ followee_id: userId });
    setFollowing(false);
    if (!error) queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  const refresh = () => {
    profile.refetch();
    stats.refetch();
    visits.refetch();
  };

  return (
    <SafeAreaView style={shared.screen} edges={isMe ? ['top'] : []}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={colors.primary} />}>
        <View style={[shared.row, { gap: 14 }]}>
          <Avatar url={p.avatar_url} name={p.display_name} size={72} />
          <View style={{ flex: 1 }}>
            <Text style={shared.h1} numberOfLines={1}>{p.display_name}</Text>
            {p.bio ? <Text style={shared.body}>{p.bio}</Text> : null}
          </View>
          {isMe && (
            <Pressable onPress={() => navigation.navigate('Settings')} hitSlop={12}>
              <Settings color={colors.muted} size={24} />
            </Pressable>
          )}
        </View>

        {!isMe && (
          <Button
            title={s?.is_following ? t('following') : t('follow')}
            variant={s?.is_following ? 'secondary' : 'primary'}
            onPress={toggleFollow}
            loading={following}
            style={{ marginTop: 16 }}
          />
        )}

        <View style={styles.stats}>
          <Stat value={isMe ? p.points : p.lifetime_points} label={isMe ? t('statPoints') : t('statTotal')} />
          <Stat value={visitedIds.size} label={t('statPlaces')} />
          <Stat value={collectionsDone} label={t('statCollections')} />
          <Stat value={s?.followers ?? 0} label={t('followers')} />
          <Stat value={s?.following ?? 0} label={t('following')} />
        </View>

        {isMe && (
          <>
            <Pressable style={styles.cardButton} onPress={() => navigation.navigate('Recap')}>
              <Sparkles color={colors.gold} size={26} />
              <View style={{ flex: 1 }}>
                <Text style={styles.cardButtonTitle}>{t('createCard')}</Text>
                <Text style={styles.cardButtonText}>{t('createCardText')}</Text>
              </View>
              <ChevronRight color="#fff" size={22} />
            </Pressable>
            <Pressable style={[shared.card, styles.invite]} onPress={() => Share.share({ message: t('inviteMessage', { code: p.referral_code }) })}>
              <View style={{ flex: 1 }}>
                <Text style={shared.label}>{t('inviteCode')}</Text>
                <Text style={styles.code}>{p.referral_code}</Text>
                <Text style={styles.inviteText}>{t('inviteText')}</Text>
              </View>
              <Share2 color={colors.primary} size={22} />
            </Pressable>
          </>
        )}

        <Text style={[shared.h2, styles.section]}>{t('collections')}</Text>
        <View style={[shared.card, { gap: 14 }]}>
          {progress.map(({ collection, done, total }) => (
            <View key={collection.id}>
              <View style={[shared.row, { justifyContent: 'space-between' }]}>
                <Text style={styles.collectionName}>{collection[`name_${lang}`]}</Text>
                <Text style={styles.collectionCount}>{done}/{total}{done === total && total > 0 ? ' ✓' : ''}</Text>
              </View>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${total ? (done / total) * 100 : 0}%`, backgroundColor: collection.color }]} />
              </View>
            </View>
          ))}
        </View>

        <Text style={[shared.h2, styles.section]}>{t('badges')}</Text>
        <View style={styles.badges}>
          {BADGES.map((badge) => {
            const earned = facts ? badge.earned(facts) : false;
            const Icon = earned ? badge.icon : Lock;
            return (
              <View key={badge.key} style={[styles.badge, !earned && { opacity: 0.45 }]}>
                <View style={[styles.badgeIcon, earned && { backgroundColor: colors.goldSoft }]}>
                  <Icon color={earned ? colors.gold : colors.faint} size={22} />
                </View>
                <Text style={styles.badgeTitle}>{t(badge.key)}</Text>
                <Text style={styles.badgeDetail}>{t(badge.detail)}</Text>
              </View>
            );
          })}
        </View>

        <Text style={[shared.h2, styles.section]}>{t('placesVisited')}</Text>
        {visits.data?.length ? (
          visits.data.map((visit) => {
            const place = placeById.get(visit.place_id);
            if (!place) return null;
            return (
              <Pressable key={visit.place_id} style={[shared.card, styles.visit]} onPress={() => navigation.push('Place', { id: place.id })}>
                <Text style={styles.visitName} numberOfLines={1}>{place[`name_${lang}`]}</Text>
                <Text style={styles.visitDate}>{new Date(visit.created_at).toLocaleDateString()}</Text>
              </Pressable>
            );
          })
        ) : (
          <Empty title={t('noVisits')} text={isMe ? t('noVisitsMine') : undefined} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 40 },
  stats: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 18, paddingVertical: 14, marginTop: 16, borderWidth: 1, borderColor: colors.line },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  statValue: { fontSize: 19, fontWeight: '900', color: colors.ink },
  statLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  cardButton: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: colors.primaryDark, borderRadius: 18, padding: 16, marginTop: 12 },
  cardButtonTitle: { color: '#fff', fontWeight: '900', fontSize: 16 },
  cardButtonText: { color: '#d6e5da', fontSize: 13, marginTop: 2 },
  invite: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 12 },
  code: { fontSize: 24, fontWeight: '900', letterSpacing: 4, color: colors.primary, marginVertical: 2 },
  inviteText: { color: colors.muted, fontSize: 13 },
  section: { marginTop: 24, marginBottom: 10 },
  collectionName: { fontWeight: '700', color: colors.ink, flex: 1 },
  collectionCount: { fontWeight: '800', color: colors.muted },
  bar: { height: 8, borderRadius: 4, backgroundColor: '#efe9df', marginTop: 6, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { width: '31%', flexGrow: 1, backgroundColor: colors.card, borderRadius: 14, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.line },
  badgeIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#eef0ee', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  badgeTitle: { fontWeight: '800', fontSize: 12, color: colors.ink, textAlign: 'center' },
  badgeDetail: { fontSize: 10, color: colors.muted, textAlign: 'center', marginTop: 2 },
  visit: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8, paddingVertical: 12 },
  visitName: { flex: 1, fontWeight: '700', color: colors.ink },
  visitDate: { color: colors.faint, fontSize: 12 },
});
