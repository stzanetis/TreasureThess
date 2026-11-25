import React, { useState } from 'react';
import { Alert, FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Gift, Star, Store } from 'lucide-react-native';
import { Empty, ErrorView, Loading, Segmented, shared } from '../components/ui';
import { useMyProfile, useSession } from '../lib/data';
import { useT } from '../lib/i18n';
import { errorMessage, rpc, supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { Nav } from '../navigation';

export const COUPON_WINDOW_MINUTES = 10;

type Coupon = {
  id: string;
  title: string;
  description: string | null;
  terms: string | null;
  cost_points: number;
  valid_until: string | null;
  partner: { name: string; logo_url: string | null; address: string | null };
};
export type Redemption = {
  id: string;
  code: string;
  created_at: string;
  activated_at: string | null;
  coupon: { title: string; terms: string | null; partner: { name: string; logo_url: string | null } };
};

export function redemptionStatus(r: Redemption): 'ready' | 'active' | 'used' {
  if (!r.activated_at) return 'ready';
  return Date.now() - new Date(r.activated_at).getTime() < COUPON_WINDOW_MINUTES * 60_000 ? 'active' : 'used';
}

export function RewardsScreen() {
  const t = useT();
  const [tab, setTab] = useState<'shop' | 'mine'>('shop');
  const profile = useMyProfile();

  return (
    <SafeAreaView style={shared.screen} edges={['top']}>
      <View style={styles.header}>
        <Text style={shared.h1}>{t('tabRewards')}</Text>
        <View style={styles.balance}>
          <Star color={colors.gold} fill={colors.gold} size={22} />
          <Text style={styles.balanceValue}>{profile.data?.points ?? '–'}</Text>
          <Text style={styles.balanceLabel}>{t('pointsToSpend')}</Text>
        </View>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'shop', label: t('coupons') }, { value: 'mine', label: t('myCoupons') }]} />
      </View>
      {tab === 'shop' ? <Shop balance={profile.data?.points ?? 0} /> : <MyCoupons />}
    </SafeAreaView>
  );
}

function Shop({ balance }: { balance: number }) {
  const t = useT();
  const navigation = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const coupons = useQuery({
    queryKey: ['coupons'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coupons')
        .select('id, title, description, terms, cost_points, valid_until, partner:partners(name, logo_url, address)')
        .order('cost_points');
      if (error) throw error;
      return (data as unknown as Coupon[]).filter((c) => c.partner && (!c.valid_until || new Date(c.valid_until) > new Date()));
    },
  });

  const redeem = (coupon: Coupon) =>
    Alert.alert(coupon.title, `${t('redeemConfirm', { n: coupon.cost_points, partner: coupon.partner.name })}\n\n${coupon.terms ?? ''}`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('redeem'),
        onPress: async () => {
          try {
            const id = await rpc<string>('redeem_coupon', { p_coupon: coupon.id });
            queryClient.invalidateQueries();
            navigation.navigate('Coupon', { redemptionId: id });
          } catch (error) {
            Alert.alert(t('couldNotRedeem'), errorMessage(error));
          }
        },
      },
    ]);

  if (coupons.isLoading) return <Loading />;
  if (coupons.error) return <ErrorView message={errorMessage(coupons.error)} onRetry={coupons.refetch} />;

  return (
    <FlatList
      data={coupons.data}
      keyExtractor={(c) => c.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={coupons.isRefetching} onRefresh={coupons.refetch} tintColor={colors.primary} />}
      ListEmptyComponent={
        <Empty
          icon={<Store color={colors.faint} size={36} />}
          title={t('couponsSoon')}
          text={t('couponsSoonText')}
        />
      }
      ListFooterComponent={
        <Pressable onPress={() => Linking.openURL('https://treasurethess.app/partners.html')}>
          <Text style={styles.partnerLink}>{t('becomePartner')}</Text>
        </Pressable>
      }
      renderItem={({ item }) => {
        const affordable = item.cost_points <= balance;
        return (
          <Pressable style={[shared.card, styles.coupon]} onPress={() => redeem(item)} disabled={!affordable}>
            {item.partner.logo_url ? <Image source={item.partner.logo_url} style={styles.logo} contentFit="cover" /> : <View style={[styles.logo, styles.logoFallback]}><Gift color="#fff" size={24} /></View>}
            <View style={{ flex: 1 }}>
              <Text style={styles.partner}>{item.partner.name}</Text>
              <Text style={styles.title}>{item.title}</Text>
              {item.description ? <Text style={styles.description} numberOfLines={2}>{item.description}</Text> : null}
            </View>
            <View style={[styles.cost, !affordable && { backgroundColor: colors.line }]}>
              <Text style={[styles.costText, !affordable && { color: colors.muted }]}>{item.cost_points}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

function MyCoupons() {
  const t = useT();
  const navigation = useNavigation<Nav>();
  const me = useSession().user.id;
  const redemptions = useQuery({
    queryKey: ['redemptions', me],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coupon_redemptions')
        .select('id, code, created_at, activated_at, coupon:coupons(title, terms, partner:partners(name, logo_url))')
        .eq('user_id', me)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as Redemption[];
    },
  });

  if (redemptions.isLoading) return <Loading />;
  if (redemptions.error) return <ErrorView message={errorMessage(redemptions.error)} onRetry={redemptions.refetch} />;

  const label = { ready: t('statusReady'), active: t('statusActive'), used: t('statusUsed') };

  return (
    <FlatList
      data={redemptions.data}
      keyExtractor={(r) => r.id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={redemptions.isRefetching} onRefresh={redemptions.refetch} tintColor={colors.primary} />}
      ListEmptyComponent={<Empty icon={<Gift color={colors.faint} size={36} />} title={t('noCoupons')} text={t('noCouponsText')} />}
      renderItem={({ item }) => {
        const status = redemptionStatus(item);
        return (
          <Pressable style={[shared.card, styles.coupon, status === 'used' && { opacity: 0.5 }]} onPress={() => navigation.navigate('Coupon', { redemptionId: item.id })}>
            <View style={{ flex: 1 }}>
              <Text style={styles.partner}>{item.coupon.partner.name}</Text>
              <Text style={styles.title}>{item.coupon.title}</Text>
            </View>
            <Text style={[styles.status, status === 'ready' && { color: colors.primary }]}>{label[status]}</Text>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8, gap: 12, paddingBottom: 10 },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: 16, padding: 16 },
  balanceValue: { fontSize: 26, fontWeight: '900', color: colors.ink },
  balanceLabel: { color: colors.muted },
  list: { padding: 16, paddingTop: 4, paddingBottom: 40 },
  coupon: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  logo: { width: 52, height: 52, borderRadius: 14 },
  logoFallback: { backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  partner: { fontSize: 12, fontWeight: '800', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { fontSize: 16, fontWeight: '800', color: colors.ink, marginTop: 2 },
  description: { color: colors.muted, fontSize: 13, marginTop: 2 },
  cost: { backgroundColor: colors.goldSoft, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  costText: { fontWeight: '900', color: '#8a6a12' },
  status: { fontWeight: '800', color: colors.muted, fontSize: 13 },
  partnerLink: { color: colors.primary, fontWeight: '800', textAlign: 'center', padding: 16 },
});
