# TreasureThess

A city explorer for Thessaloniki, built as a game (Expo SDK 54, Android and iOS, English and Greek).

- **Explore** monuments, museums and neighbourhoods on a map, grouped into collections.
- **Check in** within 100 m of a place (GPS), or by tapping the NFC tag at the place → points, once per place.
- **Collections**: visiting every place in one earns a bonus.
- **Rewards**: spend points on partner coupons; shown at the counter with a live 10-minute code.
- **Community**: feed, follows, search, weekly/all-time leaderboards, reviews, invite codes, badges,
  and a shareable "My Thessaloniki" card for Instagram stories.

## Project layout

```
app/                        the mobile app (Expo); run all npm / eas commands in here
  App.tsx                   session + providers
  src/navigation.tsx        tabs (Explore, Community, Check-in button, Rewards, Me) and stack screens
  src/screens/              one file per screen
  src/components/           PlaceMap (Leaflet in a WebView), shared UI, ErrorBoundary
  src/lib/                  supabase client, data hooks, translations (i18n.tsx), nfc, location, theme
supabase/migrations/        database schema, applied in order (shared by app and website)
website/                    static site for treasurethess.app
```

All game rules live in the database (`check_in`, `redeem_coupon`, `leaderboard`, … in
`supabase/migrations/`, latest in `005_places_and_checkins.sql`). The app never writes points directly.
All app text is in `app/src/lib/i18n.tsx` (English and Greek side by side).

## Run locally

Create `app/.env` with `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_CARTO_KEY`
(CARTO basemaps key for the map tiles), then:

```
cd app
npm install
npx expo run:android        # needs Android Studio; NFC needs a real phone
```

## Build the app

The same three variables are stored in EAS (development, preview and production environments).
To change one: `eas env:update` or expo.dev → project → Environment variables.

```
cd app
eas build -p android --profile preview      # installable APK
eas build -p ios --profile production       # needs an Apple Developer account
eas build -p android --profile production   # Play Store bundle
```

## Running it (Supabase table editor)

| Task | Where |
| --- | --- |
| Add or edit a place | `places`: names and descriptions in `_en` and `_el`, `latitude`/`longitude`, `points`, optional `image_url`, `collection_id` |
| Link an NFC tag to a place | `places.nfc_uid`: the tag's UID in upper-case hex (read it with any NFC reader app) |
| Hide a place | `places.is_active = false` |
| Add a collection | `collections` (`id`, names, `color`, `sort`) |
| Change point values or the check-in radius | `app_config` rows |
| Post an announcement in the feed | insert into `feed_events`: `kind = announcement`, `title`, `body` |
| Review partner applications | `partner_applications` |
| Add a partner / coupon | `partners`, then `coupons` (`cost_points`, optional `stock`, `valid_until`) |

The five partners named "(demo)" are fictional, there so the Rewards tab isn't empty.
Set `is_active = false` on them (in `partners` and `coupons`) before launch.

NFC tags: use NTAG213/215 stickers. Write the URL `https://treasurethess.app/place.html?id=<place id>` on
each tag (and print the same URL as a QR code next to it), then copy the tag's UID into `places.nfc_uid`.
People without the app land on the place page with a download button; people in the app's check-in screen
are checked in by the tag's UID.

## Website

`website/` is plain HTML/CSS with one small script (`site.js`, scroll animations), no build step.
`.github/workflows/pages.yml` publishes it to GitHub Pages on every push that changes `website/`
(one-time: repo Settings → Pages → Source: GitHub Actions; the custom domain is set on the same page).
`website/config.js` holds the public Supabase URL and anon key used by the partner form, the
password reset page, and `place.html` (the page NFC tags and QR codes open).

The download button points to `https://github.com/stzanetis/TreasureThess/releases/latest/download/TreasureThess.apk`,
which always serves the newest release. To ship a new APK: download it from the EAS build page, rename it to
exactly `TreasureThess.apk`, and attach it to a new GitHub release (Releases → Draft a new release → tag `v1.0.1` …).

In Supabase → Authentication → URL Configuration, set the Site URL to `https://treasurethess.app`
and add `https://treasurethess.app/reset-password.html` to the redirect URLs.
