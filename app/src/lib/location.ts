import { useEffect, useState } from 'react';
import * as Location from 'expo-location';

export type Coords = { latitude: number; longitude: number; accuracy?: number | null };

/** Returns the current position, or null if permission is denied or location is off. */
export async function getLocation(accurate = false): Promise<Coords | null> {
  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) return null;
    if (!accurate) {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
      if (last) return last.coords;
    }
    const position = await Location.getCurrentPositionAsync({
      accuracy: accurate ? Location.Accuracy.High : Location.Accuracy.Balanced,
    });
    return position.coords;
  } catch {
    return null;
  }
}

/** Follows the user's position while `enabled` is true. */
export function useWatchedLocation(enabled: boolean): Coords | null {
  const [coords, setCoords] = useState<Coords | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    getLocation().then(async (first) => {
      if (cancelled || !first) return;
      setCoords(first);
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
        (position) => setCoords(position.coords),
      );
      if (cancelled) subscription.remove();
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled]);

  return coords;
}

export function distanceMeters(a: Coords, b: Coords): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}
