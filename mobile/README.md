# FieldHorse Mobile (Expo) — spike

Native iOS/Android app built with **Expo SDK 52 + React Native 0.76 (New Architecture) + Expo Router 4 + NativeWind 4 + TanStack Query**, sharing the FieldHorse Supabase backend.

This is the **Phase 3 spike** from the 2026-stack upgrade. It proves the code-reuse thesis: the Jobs screen here uses the same query-hook shape (`useJobs`, `useJobsRealtime`) as the web app — only the rendering primitives differ (React Native `View`/`Text`/`FlatList` + NativeWind classes instead of `div` + inline styles).

> **Status: scaffold.** It was authored in a web-only CI environment, so it has NOT been installed or run against a simulator yet. It needs a real Expo dev environment to `npm install` + boot. The structure, types, and shared-logic wiring are real and `tsc`-shaped.

## What's here

```
mobile/
  app/
    _layout.tsx            root: QueryClientProvider + SafeAreaProvider + dark Stack
    (tabs)/_layout.tsx     5-tab bottom nav (Home/Jobs/Clients/Schedule/More), gold-on-onyx
    (tabs)/jobs.tsx        Jobs list — ported, uses shared useJobs() hook
    (tabs)/index|clients|schedule|more.tsx   placeholders to port next
  lib/
    supabase.ts            RN Supabase client (AsyncStorage session)
    database.types.ts      copy of the web app's generated schema types
    queries.ts             RN query hooks (same shapes as web src/lib/queries.ts)
    queryClient.ts         same Query defaults as web
  app.json                 Expo config (New Arch on, dark UI, io.fieldhorse.app)
  tailwind.config.js       NativeWind palette mirroring src/styles/tokens.css
```

## Run it

```bash
cd mobile
cp .env.example .env          # fill from the same Supabase project as web
npm install
npm run ios                   # or: npm run android / npm run web
```

## Next steps (to go from spike → shipping app)

1. **Auth context** — port the Supabase session/auth provider so `useJobsRealtime` gets a real `userId`.
2. **Port remaining screens** — Home, Clients, Schedule, ContactDetail, the sheets. Each reuses the shared query hooks.
3. **Monorepo extraction** — move `database.types.ts` + the platform-agnostic query *functions* into `packages/shared/`, imported by both `web` and `mobile`. Today they're duplicated to keep the spike self-contained.
4. **EAS** — `eas build` for store binaries, `eas update` for OTA.
5. **Push notifications** — wire `expo-notifications` to the existing `fh_notifications` table.

## Why native (vs the current PWA)

The entire iOS pain we kept hitting on the web PWA — keyboard shoving drawers into the status bar, `env(safe-area-inset)` hacks, stale service-worker builds, foggy sheets — disappears here: React Native gives real safe-area handling, a real keyboard avoider, native navigation, and no service-worker cache. Plus push notifications and offline.
