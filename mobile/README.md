# Envo Phone (Android app)

The phone app for people who want an Envo number without a PBX: sign up, send the BTRC registration
(NID details, a live selfie and both sides of the NID), get a 09639 number picked from Enfinito's
pool, activate it with a first recharge, then call any number in Bangladesh (free between Envo
numbers).

Expo SDK 58 / React Native 0.88, expo-router, TypeScript. **Status:** sign-up, the email code, the
registration (NID front and back, which the server puts on one page for the operator), recharges
(paid on Enfinito Pay's page only), balance and call history all use Envo's API (`/api/phone`,
`src/lib/api.ts`). Calls themselves are still simulated (`src/state/calls.tsx`); real calling (SIP
over WebSocket to Asterisk) is next.

## Run it on this Mac

The toolchain is installed (JDK 17, Android SDK in `~/Library/Android/sdk`, emulator `Envo_Pixel`);
`~/.zshrc` sets `JAVA_HOME` and `ANDROID_HOME`.

```bash
emulator -avd Envo_Pixel &                      # the Pixel 9 emulator (Android 16)
npx expo run:android                            # build, install and start (first build ~5 min)
npx expo start                                  # later: only the JS server; the app reloads itself
adb reverse tcp:8081 tcp:8081 && adb reverse tcp:4310 tcp:4310   # the app reaches Metro and the API on this Mac
```

In development the app talks to the API at `http://localhost:4310/api` (the server's `npm run dev`);
a release build talks to `https://envo.enfinito.cloud/api`, and `EXPO_PUBLIC_API_URL` overrides both.
Uploads go through `XMLHttpRequest`, because Expo's `fetch` can't send React Native's `{ uri }` file
parts.

`android/` is generated from `app.json` (Expo prebuild) and not committed. After changing `app.json`,
a config plugin or a native package, run `npx expo prebuild --platform android` and build again.
While the emulator runs, build with fewer workers so it doesn't hang:
`cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=4`, then
`adb install -r app/build/outputs/apk/debug/app-debug.apk`.

## Release APK (downloaded from the website)

```bash
mobile/scripts/build-apk.sh     # signed APK -> mobile/dist/envo-phone.apk (+ envo-phone.json)
deploy/deploy.sh                # uploads it when it changed; the Envo Phone page offers it
```

The website's Envo Phone page (`/phone`, and `/home/phone` when signed in) shows "Download for
Android" once an APK is on the server (`GET /api/public/phone/config` → `android`); the file is
`/api/public/phone/app/envo-phone.apk`, kept in `~/apps/envo/downloads/` on the office server, outside
the releases. An app older than "the oldest app that works" in /admin → Envo Phone is sent there.

Releases are signed with Envo Phone's own key (`plugins/withReleaseSigning.js`), kept on this Mac in
`~/.envo-release/` (the keystore and `signing.properties` with its password), never in git. **Back it
up**: every update must be signed with the same key, or phones refuse to install it over the old app.
For each release raise `version` and `android.versionCode` in `app.json`. Development builds use the
debug key and call the local API, so on the emulator `adb uninstall com.enfinito.envophone` before
switching between a release APK and `npx expo run:android`.

## Where things are

- `src/app/`: the screens' routes. Who sees what is decided in `src/app/_layout.tsx` (signed out,
  email code, KYC, or the phone). The phone opens on **Home** (`features/phone/Home.tsx`): the number,
  the balance and the one thing to do next for the person's stage (activate, payment being checked,
  being registered, no balance left). Tabs: Home, Calls, Keypad, Contacts, Account.
- `src/features/onboarding/`: welcome, sign-up, the email code, KYC (a checklist and three parts, a
  draft kept on the phone), the live selfie, the number reveal, the paused/offline/update notices.
- `src/features/phone/`: Home, keypad, calls, contacts, account, balance history, recharge,
  ringtones, call screens.
- `src/components/ui/`: buttons, fields, lists, the screen frame (keyboard-aware: the focused field
  scrolls into view), the night number card, sheets, notices, choice tiles, steps. Colours and type
  come from `src/theme/tokens.ts` through `useTheme()` (light and dark).
- `src/components/CallGate.tsx`: every place that starts a call asks it first; it says in a sheet
  why a call can't go out (activate, payment being checked, being registered, no internet, no
  balance). With no balance left, calls to Envo numbers still go out while those are free: the
  number is checked with the server first (`lib/numbers.ts`).
- `src/state/`: the session, settings (ringtone, vibrate, keypad sounds) and calls.

Sounds and icons are made by scripts, not design tools: `npm run sounds` writes
`assets/sounds/*.wav`, `npm run icons` writes `assets/images/*.png` from the logo's shapes.
