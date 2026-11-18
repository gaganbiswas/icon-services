# @icon/mobile

Android customer app: Expo SDK 58 / React Native 0.88 (Android first; iOS not in
release one).

- `bun run dev` — start Metro / Expo Go
- `bun run android` — open on a connected device or emulator
- `bun run test` — Jest (`jest-expo`) + React Native Testing Library
- `bun run doctor` — Expo dependency health check

Not yet configured (owner decisions pending): Android application ID
(`android.package`), app icon/splash branding, Play Store distribution, sign-in
method/OTP provider. Tokens will be stored only in OS secure storage (Phase 2/3).
