import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, Search, Trophy, Users } from 'lucide-react-native';
import { Avatar, Empty, ErrorView, Input, Loading, Segmented, shared, timeAgo } from '../components/ui';
import { type PersonRef, useSession } from '../lib/data';
import { useLanguage, useT } from '../lib/i18n';
import { errorMessage, rpc, supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { Nav } from '../navigation';

type FeedEvent = {
  id: number;
  kind: 'joined' | 'visited' | 'completed' | 'announcement';
  title: string | null;
  body: string | null;
  created_at: string;
  actor: PersonRef | null;
  place: { id: string; name_en: string; name_el: string } | null;
  collection: { name_en: string; name_el: string; color: string } | null;
};
type Ranking = { user_id: string; display_name: string; avatar_url: string | null; points: number; visits: number };

export function SocialScreen() {
  const t = useT();
  const [tab, setTab] = useState<'feed' | 'ranks'>('feed');
  const [following, setFollowing] = useState(false);
  const [search, setSearch] = useState('');
  const searching = search.trim().length >= 2;

  return (
    <SafeAreaView style={shared.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={shared.h1}>{t('tabCommunity')}</Text>
        <View style={styles.searchBox}>
          <Search color={colors.faint} size={18} style={styles.searchIcon} />
          <Input value={search} onChangeText={setSearch} placeholder={t('searchPeople')} autoCorrect={false} style={styles.search} />
        </View>
        {!searching && (
          <>
            <Segmented value={tab} onChange={setTab} options={[{ value: 'feed', label: t('activity') }, { value: 'ranks', label: t('leaderboard') }]} />
            <Segmented value={following ? 'following' : 'all'} onChange={(v) => setFollowing(v === 'following')} options={[{ value: 'all', label: t('everyone') }, { value: 'following', label: t('following') }]} />
          </>
        )}
      </View>
      {searching ? <People search={search.trim()} /> : tab === 'feed' ? <Feed following={following} /> : <Leaderboard following={following} />}
    </SafeAreaView>
  );
}

function People({ search }: { search: string }) {
  const t = useT();
  const navigation = useNavigation<Nav>();
  // Wait for a short pause in typing before querying.
  const [term, setTerm] = useState(search);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const people = useQuery({
    queryKey: ['people', term],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, bio')
        .ilike('display_name', `%${term.replace(/[%_\\]/g, '\\$&')}%`)
        .order('display_name')
        .limit(30);
      if (error) throw error;
      return data as (PersonRef & { bio: string | null })[];
    },
  });

  return (
    <FlatList
      data={people.data ?? []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={people.isLoading ? <Loading /> : people.error ? <ErrorView message={errorMessage(people.error)} /> : <Empty icon={<Users color={colors.faint} size={36} />} title={t('noPeople')} />}
      renderItem={({ item }) => (
        <Pressable style={[shared.card, styles.item, shared.row, { gap: 12 }]} onPress={() => navigation.navigate('Profile', { userId: item.id })}>
          <Avatar url={item.avatar_url} name={item.display_name} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.display_name}</Text>
            {item.bio ? <Text style={styles.time} numberOfLines={1}>{item.bio}</Text> : null}
          </View>
        </Pressable>
      )}
    />
  );
}

function Feed({ following }: { following: boolean }) {
  const t = useT();
  const { lang } = useLanguage();
  const navigation = useNavigation<Nav>();
  const me = useSession().user.id;

  const feed = useQuery({
    queryKey: ['feed', following],
    queryFn: async () => {
      let query = supabase
        .from('feed_events')
        .select('id, kind, title, body, created_at, actor:profiles(id, display_name, avatar_url), place:places(id, name_en, name_el), collection:collections(name_en, name_el, color)')
        .order('created_at', { ascending: false })
        .limit(60);
      if (following) {
        const { data: follows, error } = await supabase.from('follows').select('followee_id').eq('follower_id', me);
        if (error) throw error;
        const ids = [me, ...follows.map((f) => f.followee_id)];
        query = query.or(`kind.eq.announcement,actor_id.in.(${ids.join(',')})`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as FeedEvent[];
    },
  });

  if (feed.isLoading) return <Loading />;
  if (feed.error) return <ErrorView message={errorMessage(feed.error)} onRetry={feed.refetch} />;

  return (
    <FlatList
      data={feed.data}
      keyExtractor={(item) => String(item.id)}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={feed.isRefetching} onRefresh={feed.refetch} tintColor={colors.primary} />}
      ListEmptyComponent={<Empty icon={<Users color={colors.faint} size={36} />} title={t('nothingYet')} text={following ? t('followHint') : undefined} />}
      renderItem={({ item }) => {
        if (item.kind === 'announcement') {
          return (
            <View style={[shared.card, styles.item, styles.announcement]}>
              <View style={[shared.row, { gap: 8 }]}>
                <Megaphone color={colors.gold} size={18} />
                <Text style={styles.announcementTitle}>{item.title}</Text>
              </View>
              {item.body ? <Text style={[shared.body, { marginTop: 6 }]}>{item.body}</Text> : null}
              <Text style={styles.time}>{timeAgo(item.created_at, t)}</Text>
            </View>
          );
        }
        if (!item.actor) return null;
        const actor = item.actor;
        const verb = t(item.kind === 'joined' ? 'feedJoined' : item.kind === 'visited' ? 'feedVisited' : 'feedCompleted');
        const target = item.place ? item.place[`name_${lang}`] : item.collection ? item.collection[`name_${lang}`] : null;
        return (
          <Pressable
            style={[shared.card, styles.item, shared.row, { gap: 12 }]}
            onPress={() => (item.place ? navigation.navigate('Place', { id: item.place.id }) : navigation.navigate('Profile', { userId: actor.id }))}
          >
            <Pressable onPress={() => navigation.navigate('Profile', { userId: actor.id })}>
              <Avatar url={actor.avatar_url} name={actor.display_name} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.line}>
                <Text style={styles.name}>{actor.display_name}</Text> {verb}{' '}
                {target ? <Text style={[styles.name, item.collection && { color: item.collection.color }]}>{target}</Text> : null}
              </Text>
              <Text style={styles.time}>{timeAgo(item.created_at, t)}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

function Leaderboard({ following }: { following: boolean }) {
  const t = useT();
  const navigation = useNavigation<Nav>();
  const me = useSession().user.id;
  const [period, setPeriod] = useState<'week' | 'all'>('week');

  const ranks = useQuery({
    queryKey: ['leaderboard', period, following],
    queryFn: () => rpc<Ranking[]>('leaderboard', { p_period: period, p_following: following }),
  });

  return (
    <FlatList
      data={ranks.data ?? []}
      keyExtractor={(item) => item.user_id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={ranks.isRefetching} onRefresh={ranks.refetch} tintColor={colors.primary} />}
      ListHeaderComponent={
        <View style={{ marginBottom: 12 }}>
          <Segmented value={period} onChange={setPeriod} options={[{ value: 'week', label: t('thisWeek') }, { value: 'all', label: t('allTime') }]} />
        </View>
      }
      ListEmptyComponent={ranks.isLoading ? <Loading /> : ranks.error ? <ErrorView message={errorMessage(ranks.error)} /> : <Empty icon={<Trophy color={colors.faint} size={36} />} title={t('noPointsYet')} />}
      renderItem={({ item, index }) => (
        <Pressable
          style={[shared.card, styles.item, shared.row, { gap: 12 }, item.user_id === me && styles.mine]}
          onPress={() => navigation.navigate('Profile', { userId: item.user_id })}
        >
          <Text style={[styles.rank, index < 3 && { color: colors.gold }]}>{index + 1}</Text>
          <Avatar url={item.avatar_url} name={item.display_name} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.display_name}</Text>
            <Text style={styles.time}>{t('placesVisitedCount', { n: item.visits })}</Text>
          </View>
          <Text style={styles.score}>{item.points}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8, gap: 10, paddingBottom: 10 },
  searchBox: { justifyContent: 'center' },
  searchIcon: { position: 'absolute', left: 14, zIndex: 1 },
  search: { marginBottom: 0, paddingLeft: 42 },
  list: { padding: 16, paddingTop: 4, paddingBottom: 40 },
  item: { marginBottom: 8 },
  announcement: { backgroundColor: colors.goldSoft },
  announcementTitle: { fontWeight: '800', fontSize: 16, color: colors.ink, flex: 1 },
  line: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  name: { fontWeight: '800', color: colors.ink },
  time: { color: colors.faint, fontSize: 12, marginTop: 3 },
  rank: { width: 26, fontSize: 17, fontWeight: '900', color: colors.muted, textAlign: 'center' },
  score: { fontWeight: '900', fontSize: 17, color: colors.primary },
  mine: { borderWidth: 2, borderColor: colors.primary },
});
