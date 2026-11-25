import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'react-native-qrcode-svg';
import { Sparkles } from 'lucide-react-native';
import { Button, ErrorView, Loading, shared } from '../components/ui';
import { useT } from '../lib/i18n';
import { errorMessage, rpc, supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { RootStackParamList } from '../navigation';
import { COUPON_WINDOW_MINUTES, type Redemption, redemptionStatus } from './RewardsScreen';

export function CouponScreen() {
  const t = useT();
  const { redemptionId } = useRoute<RouteProp<RootStackParamList, 'Coupon'>>().params;
  const queryClient = useQueryClient();
  const [now, setNow] = useState(Date.now());
  const [activating, setActivating] = useState(false);

  const redemption = useQuery({
    queryKey: ['redemption', redemptionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coupon_redemptions')
        .select('id, code, created_at, activated_at, coupon:coupons(title, terms, partner:partners(name, logo_url))')
        .eq('id', redemptionId)
        .single();
      if (error) throw error;
      return data as unknown as Redemption;
    },
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (redemption.isLoading) return <Loading />;
  if (redemption.error || !redemption.data) return <ErrorView message={errorMessage(redemption.error)} onRetry={redemption.refetch} />;

  const r = redemption.data;
  const status = redemptionStatus(r);
  const secondsLeft = r.activated_at ? Math.max(0, Math.round((new Date(r.activated_at).getTime() + COUPON_WINDOW_MINUTES * 60_000 - now) / 1000)) : 0;

  const activate = () =>
    Alert.alert(t('startNowTitle'), t('startNowText', { n: COUPON_WINDOW_MINUTES }), [
      { text: t('notYet'), style: 'cancel' },
      {
        text: t('start'),
        onPress: async () => {
          setActivating(true);
          try {
            await rpc('activate_coupon', { p_redemption: r.id });
            await redemption.refetch();
            queryClient.invalidateQueries({ queryKey: ['redemptions'] });
          } catch (error) {
            Alert.alert(t('couldNotStart'), errorMessage(error));
          } finally {
            setActivating(false);
          }
        },
      },
    ]);

  return (
    <ScrollView style={shared.screen} contentContainerStyle={styles.content}>
      <Text style={styles.partner}>{r.coupon.partner.name}</Text>
      <Text style={[shared.h1, { textAlign: 'center' }]}>{r.coupon.title}</Text>

      {status === 'ready' && (
        <>
          <Text style={[shared.body, styles.center]}>{t('couponReady')}</Text>
          <Button title={t('showToStaff')} onPress={activate} loading={activating} style={{ alignSelf: 'stretch' }} />
        </>
      )}

      {status === 'active' && (
        <View style={styles.ticket}>
          <LiveBadge />
          <QRCode value={`treasurethess:${r.code}`} size={180} color={colors.ink} />
          <Text style={styles.code}>{r.code}</Text>
          <Text style={styles.timer}>
            {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
          </Text>
          <Text style={styles.small}>{t('liveHint')}</Text>
        </View>
      )}

      {status === 'used' && <Text style={[shared.body, styles.center]}>{t('couponUsed')}</Text>}

      {r.coupon.terms ? <Text style={[styles.small, { marginTop: 20 }]}>{r.coupon.terms}</Text> : null}
    </ScrollView>
  );
}

function LiveBadge() {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View style={styles.live}>
      <Animated.View style={{ transform: [{ rotate }] }}><Sparkles color={colors.gold} size={20} /></Animated.View>
      <Text style={styles.liveText}>LIVE</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, alignItems: 'center', gap: 12 },
  partner: { fontSize: 13, fontWeight: '800', color: colors.primary, textTransform: 'uppercase', letterSpacing: 1 },
  center: { textAlign: 'center' },
  ticket: { alignSelf: 'stretch', backgroundColor: colors.card, borderRadius: 24, padding: 24, alignItems: 'center', gap: 12, marginTop: 8 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveText: { fontWeight: '900', color: colors.gold, letterSpacing: 2 },
  code: { fontSize: 32, fontWeight: '900', letterSpacing: 6, color: colors.ink },
  timer: { fontSize: 22, fontWeight: '800', color: colors.primary },
  small: { color: colors.muted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
});
