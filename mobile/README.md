# FieldHorse Mobile (Expo)

Native iOS/Android app — **Expo SDK 52 + React Native 0.76 (New Architecture) + Expo Router 4 + NativeWind 4 + TanStack Query**, sharing the FieldHorse Supabase backend with the web app.

It now has **auth + the five core screens wired to live data**, so it boots into a real signed-in app — not a placeholder shell.

## What works today

```
mobile/
  app/
    _layout.tsx              root: providers + auth redirect gate (login ⇄ tabs)
    login.tsx                email/password sign-in (same Supabase as web)
    (tabs)/
      _layout.tsx            5-tab native bottom nav (gold-on-onyx)
      index.tsx              Home — greeting + pipeline/won/active KPIs + recent jobs
      jobs.tsx               Jobs — searchable pipeline list, realtime
      clients.tsx            Clients — roster with lifetime/active rollups
      schedule.tsx           Schedule — next 7 days, grouped by day
      more.tsx               Account + sign out
  contexts/AuthContext.tsx   Supabase session provider (AsyncStorage)
  lib/
    supabase.ts              RN client (AsyncStorage session)
    queries.ts               shared hooks: useJobs, useClientsBundle, useUpcomingEvents, …
    database.types.ts        generated schema types (same as web)
  app.json                   Expo config (New Arch, dark, io.fieldhorse.app)
  eas.json                   EAS build + submit profiles
```

Everything reuses the **same query-hook shapes as the web app** — only the rendering primitives differ (RN `View`/`Text`/`FlatList` + NativeWind classes instead of `div` + inline styles).

---

## 1) Run it on your phone (development)

**Prereqs:** Node 18+, and the **Expo Go** app on your phone. Phone + computer on the same wifi.

```bash
cd mobile
cp .env.example .env          # then paste your Supabase anon key (see below)
npm install
npx expo start
```

Scan the QR code: **iPhone** → Camera app → tap the banner; **Android** → Expo Go → "Scan QR code". The app loads and live-reloads.

**The `.env`** (same project the web app uses — anon key is safe to expose, RLS protects the data):
```
EXPO_PUBLIC_SUPABASE_URL=https://pnmhblvslftdzfcdezbw.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the same key as web VITE_SUPABASE_ANON_KEY>
```
Find the key in the Supabase dashboard → Project Settings → API → **anon public**.

You'll land on the login screen → sign in with your existing FieldHorse credentials → the tabs load your real jobs, clients, and schedule.

> If `npm install` complains about native versions, run `npx expo install --fix`.

---

## 2) Ship it to the App Store (production)

**Prereqs:**
- An **Apple Developer account** ($99/yr) — required by Apple to publish.
- An **Expo account** (free) — `npx expo register` or `npx expo login`.
- The **EAS CLI**: `npm install -g eas-cli`.
- An **app icon**: drop a 1024×1024 PNG at `mobile/assets/icon.png` and reference it in `app.json` (`"icon": "./assets/icon.png"`). Builds work without one (Expo default), but the App Store requires a real icon.

### a. One-time setup
```bash
cd mobile
eas login
eas build:configure           # links this project to your Expo account
```

### b. Give the production build its Supabase keys
EAS cloud builds don't read your local `.env`. Register the two public vars once:
```bash
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value "https://pnmhblvslftdzfcdezbw.supabase.co"
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<your anon key>"
```

### c. Build the iOS binary (in Expo's cloud — no Mac required)
```bash
eas build --platform ios --profile production
```
First run: EAS walks you through Apple credentials (it can create the signing certs + provisioning profile for you). Output is an `.ipa`.

### d. Send it to TestFlight / App Store
```bash
eas submit --platform ios --profile production --latest
```
This uploads the build to App Store Connect. From there:
- It appears in **TestFlight** for you (and testers) to install on real devices.
- To go live: in **App Store Connect**, create the app listing (name, screenshots, description, privacy), attach the build, and submit for review. Apple review typically takes a day or two.

### e. Updating later
- **JS-only changes** (most of your work): `eas update --branch production` pushes over-the-air — users get it on next launch, no re-review.
- **Native changes** (new native module, SDK bump): re-run `eas build` + `eas submit`.

Android is the same flow with `--platform android` (and a Google Play Developer account, $25 one-time).

---

## Roadmap (next increments)
1. **Job detail screen** — tap a job → full detail/tabs (the web ContactDetail equivalent).
2. **Create/edit flows** — new lead, log payment, add schedule event (mutations + optimistic cache, mirroring web).
3. **Push notifications** — `expo-notifications` wired to the existing `fh_notifications` table.
4. **Monorepo extraction** — move `database.types.ts` + the platform-agnostic query *functions* into `packages/shared/`, imported by both `web` and `mobile` (today they're duplicated to keep this self-contained).

## Why native (vs the PWA)
Real safe-area handling, a real keyboard avoider, native navigation + 60fps scrolling, push notifications, offline, and App Store distribution — none of which an iOS PWA does well. Same screens, same data, no service-worker cache to go stale.
