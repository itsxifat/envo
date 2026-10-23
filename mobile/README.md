# Envo Phone (Android app)

The phone app for people who want an Envo number without a PBX: sign up, send the BTRC registration
(NID, address, a selfie and both sides of the NID), get a 09639 number picked from Enfinito's pool, activate it with a first
recharge, then call any number in Bangladesh (free between Envo numbers).

Expo SDK 58 / React Native 0.88, expo-router, TypeScript. **Status:** sign-up, the email code, the
registration (NID front and back, which the server puts on one page for the operator), recharges,
balance and call history all use Envo's API (`/api/phone`, `src/lib/api.ts`). Calls themselves are
still simulated (`src/state/calls.tsx`); real calling (SIP over WebSocket to Asterisk) is next.

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

## Where things are

- `src/app/`: the screens' routes. Who sees what is decided in `src/app/_layout.tsx` (signed out,
  KYC, or the phone).
- `src/features/onboarding/`: welcome, sign-up, KYC, the number reveal.
- `src/features/phone/`: keypad, recents, contacts, account, recharge, ringtones, call screens.
- `src/components/ui/`: buttons, fields, lists, the screen frame. Colours and type come from
  `src/theme/tokens.ts` through `useTheme()` (light and dark).
- `src/state/`: the session, settings (ringtone, vibrate, keypad sounds) and calls.

Sounds and icons are made by scripts, not design tools: `npm run sounds` writes
`assets/sounds/*.wav`, `npm run icons` writes `assets/images/*.png` from the logo's shapes.
