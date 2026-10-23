# Envo Phone (Android app)

The phone app for people who want an Envo number without a PBX: sign up, send the BTRC registration
(NID, address, two photos), get a 09639 number picked from Enfinito's pool, activate it with a first
recharge, then call any number in Bangladesh (free between Envo numbers).

Expo SDK 58 / React Native 0.88, expo-router, TypeScript. **Status:** the whole flow and every screen
are built and tried on the emulator, but they still run on sample data (`src/state/session.tsx`) and
calls are simulated (`src/state/calls.tsx`). Next: Envo's API for accounts and KYC, then real calls
(SIP over WebSocket to Asterisk).

## Run it on this Mac

The toolchain is installed (JDK 17, Android SDK in `~/Library/Android/sdk`, emulator `Envo_Pixel`);
`~/.zshrc` sets `JAVA_HOME` and `ANDROID_HOME`.

```bash
emulator -avd Envo_Pixel &                      # the Pixel 9 emulator (Android 16)
npx expo run:android                            # build, install and start (first build ~5 min)
npx expo start                                  # later: only the JS server; the app reloads itself
```

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
