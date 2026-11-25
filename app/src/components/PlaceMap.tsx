import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { LocateFixed } from 'lucide-react-native';
import type { Place } from '../lib/data';
import type { Coords } from '../lib/location';
import { colors } from '../lib/theme';

type Props = {
  places: Place[];
  colorOf: (place: Place) => string;
  visitedIds: Set<string>;
  me: Coords | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
};

// CARTO basemaps key, from .env locally and from EAS environment variables in cloud builds.
const cartoKey = encodeURIComponent(process.env.EXPO_PUBLIC_CARTO_KEY ?? '');

// The page is built once; data is pushed in with injectJavaScript so the map never reloads.
const html = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
  html, body, #map { height: 100%; margin: 0; background: ${colors.bg}; }
  .pin { width: 28px; height: 28px; border-radius: 50%; border: 3px solid #fff; color: #fff; display: flex;
         align-items: center; justify-content: center; font: bold 13px sans-serif; box-shadow: 0 2px 6px rgba(0,0,0,.3);
         transition: transform .15s; }
  .pin.selected { transform: scale(1.35); }
  .me { width: 16px; height: 16px; border-radius: 50%; background: #2f7fb5; border: 3px solid #fff;
        box-shadow: 0 0 0 6px rgba(47,127,181,.2); }
</style></head><body><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
  const map = L.map('map', { zoomControl: false }).setView([40.6335, 22.9475], 15);
  L.tileLayer('https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${cartoKey}', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap &copy; CARTO'
  }).addTo(map);
  const send = (message) => window.ReactNativeWebView.postMessage(JSON.stringify(message));
  let pins = L.layerGroup().addTo(map), me = null;

  window.setPlaces = (list, selectedId) => {
    pins.clearLayers();
    list.forEach((p) => {
      const icon = L.divIcon({ className: '', iconSize: [28, 28], iconAnchor: [14, 14],
        html: '<div class="pin' + (p.id === selectedId ? ' selected' : '') + '" style="background:' + p.color + '">' + (p.visited ? '&#10003;' : '') + '</div>' });
      L.marker([p.lat, p.lng], { icon, zIndexOffset: p.id === selectedId ? 1000 : 0 })
        .on('click', (e) => { L.DomEvent.stopPropagation(e); send({ select: p.id }); }).addTo(pins);
    });
  };
  window.setMe = (lat, lng, recenter) => {
    if (!me) me = L.marker([lat, lng], { interactive: false, icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(map);
    me.setLatLng([lat, lng]);
    if (recenter) map.flyTo([lat, lng], 16, { duration: 0.6 });
  };
  window.focusOn = (lat, lng) => map.flyTo([lat, lng], Math.max(map.getZoom(), 16), { duration: 0.5 });
  map.on('click', () => send({ select: null }));
  send({ ready: true });
</script></body></html>`;

export function PlaceMap({ places, colorOf, visitedIds, me, selectedId, onSelect }: Props) {
  const webView = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const centeredOnce = useRef(false);
  const run = (js: string) => webView.current?.injectJavaScript(`${js}; true;`);

  useEffect(() => {
    if (!ready) return;
    const pins = places.map((p) => ({ id: p.id, lat: p.latitude, lng: p.longitude, color: colorOf(p), visited: visitedIds.has(p.id) }));
    run(`setPlaces(${JSON.stringify(pins)}, ${JSON.stringify(selectedId)})`);
  }, [ready, places, visitedIds, selectedId]);

  useEffect(() => {
    const selected = places.find((p) => p.id === selectedId);
    if (ready && selected) run(`focusOn(${selected.latitude}, ${selected.longitude})`);
  }, [ready, selectedId]);

  useEffect(() => {
    if (!ready || !me) return;
    run(`setMe(${me.latitude}, ${me.longitude}, ${!centeredOnce.current})`);
    centeredOnce.current = true;
  }, [ready, me?.latitude, me?.longitude]);

  const onMessage = (event: WebViewMessageEvent) => {
    const message = JSON.parse(event.nativeEvent.data) as { ready?: boolean; select?: string | null };
    if (message.ready) setReady(true);
    if (message.select !== undefined) onSelect(message.select);
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webView}
        source={{ html }}
        originWhitelist={['*']}
        onMessage={onMessage}
        style={{ backgroundColor: colors.bg }}
        setSupportMultipleWindows={false}
      />
      <Pressable style={styles.locate} onPress={() => me && run(`setMe(${me.latitude}, ${me.longitude}, true)`)}>
        <LocateFixed color={colors.primary} size={22} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  locate: {
    position: 'absolute', right: 16, top: 16, width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', elevation: 4,
  },
});
