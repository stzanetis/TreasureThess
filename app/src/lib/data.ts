import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { rpc, supabase } from './supabase';

export type Collection = { id: string; name_en: string; name_el: string; color: string };

export type Place = {
  id: string;
  collection_id: string;
  name_en: string;
  name_el: string;
  description_en: string | null;
  description_el: string | null;
  latitude: number;
  longitude: number;
  points: number;
  image_url: string | null;
};

export type Visit = { place_id: string; created_at: string };

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  points: number;
  lifetime_points: number;
  referral_code: string;
};

export type ProfileStats = {
  visits: number;
  reviews: number;
  coupons: number;
  followers: number;
  following: number;
  is_following: boolean;
};

export type PersonRef = { id: string; display_name: string; avatar_url: string | null };

export const SessionContext = createContext<Session | null>(null);

/** Only used inside signed-in screens, where a session always exists. */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession used outside a signed-in screen');
  return session;
}

export function useProfile(userId: string) {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, bio, points, lifetime_points, referral_code')
        .eq('id', userId)
        .single();
      if (error) throw error;
      return data as Profile;
    },
  });
}

export function useMyProfile() {
  return useProfile(useSession().user.id);
}

export function useProfileStats(userId: string) {
  return useQuery({
    queryKey: ['stats', userId],
    queryFn: () => rpc<ProfileStats>('profile_stats', { p_user: userId }),
  });
}

/** Point values and limits from the app_config table. */
export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('app_config').select('key, value');
      if (error) throw error;
      return Object.fromEntries(data.map((row) => [row.key, row.value])) as Record<string, number>;
    },
  });
}

export function usePlaces() {
  return useQuery({
    queryKey: ['places'],
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      // nfc_uid is a private column, so the columns are listed explicitly.
      const { data, error } = await supabase
        .from('places')
        .select('id, collection_id, name_en, name_el, description_en, description_el, latitude, longitude, points, image_url')
        .order('name_en');
      if (error) throw error;
      return data as Place[];
    },
  });
}

export function useCollections() {
  return useQuery({
    queryKey: ['collections'],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from('collections').select('id, name_en, name_el, color').order('sort');
      if (error) throw error;
      return data as Collection[];
    },
  });
}

/** A user's check-ins, newest first. */
export function useVisits(userId: string) {
  return useQuery({
    queryKey: ['visits', userId],
    queryFn: async () => {
      const { data, error } = await supabase.from('visits').select('place_id, created_at').eq('user_id', userId).order('created_at', { ascending: false });
      if (error) throw error;
      return data as Visit[];
    },
  });
}

export function useMyVisits() {
  return useVisits(useSession().user.id);
}

/** How many places of each collection a set of visits covers. */
export function collectionProgress(collections: Collection[], places: Place[], visitedIds: Set<string>) {
  return collections.map((collection) => {
    const inCollection = places.filter((p) => p.collection_id === collection.id);
    return { collection, total: inCollection.length, done: inCollection.filter((p) => visitedIds.has(p.id)).length };
  });
}
