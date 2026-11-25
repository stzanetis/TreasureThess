import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { NavigationContainer, DefaultTheme, type NavigatorScreenParams } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator, type NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Compass, Gift, MapPinCheck, User, Users } from 'lucide-react-native';
import { AuthScreen } from './screens/AuthScreen';
import { CheckInScreen } from './screens/CheckInScreen';
import { CouponScreen } from './screens/CouponScreen';
import { ExploreScreen } from './screens/ExploreScreen';
import { PlaceScreen } from './screens/PlaceScreen';
import { MyProfileScreen, ProfileScreen } from './screens/ProfileScreen';
import { RecapScreen } from './screens/RecapScreen';
import { RewardsScreen } from './screens/RewardsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SocialScreen } from './screens/SocialScreen';
import { useT } from './lib/i18n';
import { colors } from './lib/theme';

type TabParamList = { Explore: undefined; Community: undefined; CheckInButton: undefined; Rewards: undefined; Me: undefined };

export type RootStackParamList = {
  Auth: undefined;
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  CheckIn: { placeId?: string } | undefined;
  Place: { id: string };
  Profile: { userId: string };
  Coupon: { redemptionId: string };
  Recap: undefined;
  Settings: undefined;
};

export type Nav = NativeStackNavigationProp<RootStackParamList>;

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.bg, primary: colors.primary, card: colors.bg } };

// The middle tab only hosts the check-in button, which opens the CheckIn screen instead of a tab.
const Nothing = () => null;

function Tabs({ navigation }: { navigation: Nav }) {
  const t = useT();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.line },
        tabBarLabelStyle: { fontWeight: '700' },
      }}
    >
      <Tab.Screen name="Explore" component={ExploreScreen} options={{ title: t('tabExplore'), tabBarIcon: ({ color }) => <Compass color={color} size={22} /> }} />
      <Tab.Screen name="Community" component={SocialScreen} options={{ title: t('tabCommunity'), tabBarIcon: ({ color }) => <Users color={color} size={22} /> }} />
      <Tab.Screen
        name="CheckInButton"
        component={Nothing}
        options={{
          tabBarLabel: () => null,
          tabBarButton: () => (
            <View style={styles.slot}>
              <Pressable style={styles.button} onPress={() => navigation.navigate('CheckIn')}>
                <MapPinCheck color="#fff" size={28} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Tab.Screen name="Rewards" component={RewardsScreen} options={{ title: t('tabRewards'), tabBarIcon: ({ color }) => <Gift color={color} size={22} /> }} />
      <Tab.Screen name="Me" component={MyProfileScreen} options={{ title: t('tabMe'), tabBarIcon: ({ color }) => <User color={color} size={22} /> }} />
    </Tab.Navigator>
  );
}

export function Navigation({ signedIn }: { signedIn: boolean }) {
  const t = useT();
  return (
    <NavigationContainer theme={theme}>
      <Stack.Navigator screenOptions={{ headerTintColor: colors.ink, headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false, headerTitleStyle: { fontWeight: '800' } }}>
        {signedIn ? (
          <>
            <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
            <Stack.Screen name="CheckIn" component={CheckInScreen} options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="Place" component={PlaceScreen} options={{ title: '' }} />
            <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: '' }} />
            <Stack.Screen name="Coupon" component={CouponScreen} options={{ title: t('coupon') }} />
            <Stack.Screen name="Recap" component={RecapScreen} options={{ title: t('myThessaloniki') }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: t('settings') }} />
          </>
        ) : (
          <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  slot: { flex: 1, alignItems: 'center' },
  button: {
    width: 62, height: 62, borderRadius: 31, marginTop: -22, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: colors.bg, elevation: 6,
  },
});
