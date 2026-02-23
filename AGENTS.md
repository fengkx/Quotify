# AGENTS.md

## Scope

This file applies to the whole repository: `/Users/fengkx/me/code/Quotify`.

## Project Overview

- React Native CLI app (not Expo)
- Platforms: Android + iOS
- Main scripts are defined in `package.json`
- Android native project exists in `android/`
- iOS native project exists in `ios/`

## Dependency Management

- Prefer `npm` for this repo because `package-lock.json` is present and scripts are npm-oriented.
- Do not update both lockfiles (`package-lock.json` and `yarn.lock`) unless the user explicitly asks for dependency changes.
- Avoid manual edits to dependency declarations when a package manager command is more appropriate.

## Common Commands

- Install JS deps: `npm install`
- Start Metro: `npm start`
- Run Android: `npm run android`
- Run iOS: `npm run ios`
- Lint: `npm run lint`
- Test: `npm test`

## Android Development Notes (Important)

### SDK / Java

- This project may require local Android SDK path config via `android/local.properties`:

```properties
sdk.dir=/Users/<username>/Library/Android/sdk
```

- `android/local.properties` is local machine config and should not be committed.
- If system Java is not installed, Android Studio bundled JBR can be used:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
```

### Emulator / Device

- Confirm device is online before running Android builds:

```bash
adb devices -l
```

- For emulator/USB Metro connectivity issues, verify reverse port mapping:

```bash
adb reverse tcp:8081 tcp:8081
```

### Metro Stability on macOS

- Prefer installing and using `watchman` to avoid Metro crashes with `EMFILE` (`too many open files, watch`).
- If Metro crashes with `EMFILE`, install watchman and restart Metro.
- A practical Metro start command on macOS is:

```bash
ulimit -n 65536; npm start
```

## Recommended Android Run Flow (Local)

1. Start an Android emulator (AVD) in Android Studio Device Manager.
2. Start Metro in a separate terminal (`npm start`).
3. Ensure `adb reverse tcp:8081 tcp:8081` is set (mainly for physical devices; harmless on emulator).
4. Run app install without auto-starting a new packager terminal if needed:

```bash
npx react-native run-android --no-packager
```

## Editing Guidelines

- Keep changes minimal and scoped to the user request.
- Prefer readable code over clever code.
- Follow existing naming and code style in nearby files.
- Add comments only when intent is non-obvious (explain why, not what).
- Avoid unrelated refactors unless they directly unblock the requested change.

## Testing / Validation Expectations

- For UI or JS logic changes: run targeted checks if possible (`npm test`, app smoke run).
- For Android-native or build changes: at minimum verify `npm run android` (or `run-android --no-packager`) reaches install/start.
- Report what was actually validated and what was not.

## Git / Local Changes Safety

- Do not revert unrelated user changes.
- Be careful with lockfiles and generated files.
- Avoid destructive git commands unless explicitly requested.

