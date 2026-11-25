import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { ErrorView, Loading } from './src/components/ui';
import { SessionContext } from './src/lib/data';
import { LanguageProvider } from './src/lib/i18n';
import { nfcSupported } from './src/lib/nfc';
import { hasSupabaseConfig, supabase } from './src/lib/supabase';
import { Navigation } from './src/navigation';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    nfcSupported();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) queryClient.clear();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <SafeAreaProvider>
      <LanguageProvider>
        <StatusBar style="dark" />
        <ErrorBoundary>
          {!hasSupabaseConfig ? (
            <ErrorView message="This build is missing its server settings (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY)." />
          ) : loading ? (
            <Loading />
          ) : (
            <QueryClientProvider client={queryClient}>
              <SessionContext.Provider value={session}>
                <Navigation signedIn={Boolean(session)} />
              </SessionContext.Provider>
            </QueryClientProvider>
          )}
        </ErrorBoundary>
      </LanguageProvider>
    </SafeAreaProvider>
  );
}
