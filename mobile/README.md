# FieldHorse Mobile (Expo)

Native iOS and Android app built with Expo SDK 54, React Native 0.81.5 (New Architecture), Expo Router 6, React 19.1, NativeWind 4 and TanStack Query. It signs in to the same Supabase project as the web app and reads the same data.

## What is in it

```
mobile/
  app/
    _layout.tsx          providers and the sign in gate
    login.tsx, reset-password.tsx, onboarding.tsx
    (tabs)/              Home, Jobs, Clients, Schedule, More
    jobs/[id].tsx        job detail
    quote/[id].tsx       quote detail and approval
    invoices/            invoice list and detail
    clients/[id].tsx     client detail
    subs/                subcontractors
    activity, analytics, assistant, bid, compose, estimates, integrations,
    notes, notifications, partners, pour-window, settings
  contexts/AuthContext.tsx   Supabase session (AsyncStorage)
  lib/
    supabase.ts          React Native Supabase client
    queries.ts           query hooks shaped like the web app's
    database.types.ts    generated schema types (an older copy, see below)
    quotePdf.ts, invoiceHtml.ts, proposalHtml.ts, sendDocs.ts and more
  app.json               Expo config (io.fieldhorse.app, dark, New Architecture)
  eas.json               EAS build and submit profiles
```

`lib/database.types.ts` is older than the web copy in `src/lib/database.types.ts` and is missing newer tables such as the company and time clock tables. Regenerate it from the same command in `SHIP.md` before relying on those types here.

## 1. Run it on your phone

You need Node 22 (the same as the web app) and the Expo Go app on your phone, with the phone and the computer on the same network.

```bash
cd mobile
cp .env.example .env          # then paste the Supabase anon key
npm install
npx expo start
```

Scan the QR code with the iPhone Camera app, or from Expo Go on Android. The app loads and reloads as you edit.

The `.env` points at the same project as the web app. The anon key is safe to ship because row level security protects the data:

```
EXPO_PUBLIC_SUPABASE_URL=https://pnmhblvslftdzfcdezbw.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<the same key as the web VITE_SUPABASE_ANON_KEY>
```

The key is in the Supabase dashboard under Project Settings, API, anon public. If `npm install` complains about native versions, run `npx expo install --fix`.

## 2. Ship it to the App Store

What you need first:

* An Apple Developer account. Apple charges a yearly fee to publish.
* An Expo account (`npx expo login`) and the EAS CLI (`npm install -g eas-cli`).

One time setup:

```bash
cd mobile
eas login
eas init                      # links the project and writes its id into app.json
```

`.github/workflows/eas-build.yml` builds on a `mobile-v*` tag and runs without prompts, so commit the project id that `eas init` writes, or that workflow cannot run. The Apple ID in `eas.json` is better kept out of the repo: set it as the `EXPO_APPLE_ID` secret instead.

Give production builds their Supabase keys, since EAS cloud builds do not read your local `.env`:

```bash
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value "https://pnmhblvslftdzfcdezbw.supabase.co"
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<your anon key>"
```

Build and submit:

```bash
eas build --platform ios --profile production
eas submit --platform ios --profile production --latest
```

The first build walks you through Apple signing. The submit step uploads to App Store Connect, where the build shows up in TestFlight. To go live, create the listing in App Store Connect, attach the build and submit it for review.

Later updates: JavaScript only changes can go out with `eas update --branch production` and reach people on their next launch. Native changes, such as a new native module or an SDK upgrade, need a new `eas build` and `eas submit`. Android follows the same steps with `--platform android` and a Google Play developer account.

## Next steps

1. Push notifications through `expo-notifications`, fed by the existing `fh_notifications` table.
2. Share the schema types and the platform neutral query functions with the web app in one package, so the two copies stop drifting.
3. Add `npm --prefix mobile run typecheck` to CI.
