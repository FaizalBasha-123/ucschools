# Schools24 Play Store Release Guide

This project's Android app lives in `client/android-mobile` and is a Capacitor Android app with package name `in.schools24.app`.

Current app version:
- `versionCode 2`
- `versionName 1.0.1`

## 1. What you need before Play Store upload

You need all of these:
- A Google Play Console account
- The app icon, screenshots, privacy policy URL, and app description
- A release keystore
- A signed Android App Bundle (`.aab`)

Important:
- Play Store wants an **AAB**, not the debug APK you were using earlier.
- The app must be signed with your **upload key**.

## 2. Generate a release keystore

Run this in PowerShell:

```powershell
cd D:\Schools24-Workspace\client\android-mobile
keytool -genkeypair -v `
  -keystore release-keystore.jks `
  -alias upload `
  -keyalg RSA `
  -keysize 2048 `
  -validity 10000
```

Keep this file safe:
- `release-keystore.jks`

Do not lose it. Back it up outside the repo too.

## 3. Create `key.properties`

Create this file:
- `client/android-mobile/key.properties`

Use this format:

```properties
storeFile=release-keystore.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=upload
keyPassword=YOUR_KEY_PASSWORD
```

There is also a template file here:
- `client/android-mobile/key.properties.example`

## 4. Sync the latest web app into Android

Because this app is a Capacitor shell, first sync the frontend into Android:

```powershell
cd D:\Schools24-Workspace\Schools24-frontend
$env:NODE_ENV="production"
npx cap sync android
```

## 5. Build the Play Store bundle

Now build the release bundle:

```powershell
cd D:\Schools24-Workspace\client\android-mobile
.\gradlew.bat bundleRelease
```

Expected output:
- `client/android-mobile/app/build/outputs/bundle/release/app-release.aab`

## 6. Create the app in Google Play Console

Go to:
- https://play.google.com/console

Then:
1. Click **Create app**
2. Enter app name: `Schools24`
3. Choose default language
4. Choose **App**
5. Choose **Free** or **Paid**
6. Complete policy declarations

## 7. Upload the AAB

In Play Console:
1. Open your app
2. Go to **Test and release**
3. Start with **Internal testing**
4. Create a new release
5. Upload:
   - `app-release.aab`

Internal testing is the safest first release for a beginner.

## 8. Fill store listing

You will need:
- App icon: 512 x 512
- Feature graphic: 1024 x 500
- Phone screenshots
- Tablet screenshots if applicable
- Privacy policy URL
- Short description
- Full description

## 9. Complete the required Play Console forms

You will usually need to fill:
- App access
- Ads declaration
- Content rating
- Data safety
- Target audience

Because Schools24 handles school data, do not guess on Data Safety. Fill it carefully.

## 10. Submit safely

Recommended first path:
1. Internal testing
2. Closed testing
3. Production

That lets you catch crashes or permission issues before public release.

## 11. Versioning rule for next releases

Every Play Store upload must increase `versionCode`.

Example:
- first upload: `versionCode 2`, `versionName 1.0.1`
- next upload: `versionCode 3`, `versionName 1.0.2`

Version file:
- `client/android-mobile/app/build.gradle`

## 12. Important notes for this project

- This Android app points at:
  - `https://dash.schools24.in`
- So most UI/content updates come from the web app.
- But you still need a new Android release when you change:
  - native permissions
  - icons
  - splash behavior
  - notification config
  - Android manifest / package config

## 13. What I already prepared

I updated:
- `client/android-mobile/app/build.gradle`
  - `versionCode 2`
  - `versionName 1.0.1`
  - release signing config support via `key.properties`

I also added:
- `client/android-mobile/key.properties.example`
- `PLAYSTORE_RELEASE_GUIDE.md`

## 14. What is still missing before actual upload

You still need to do these yourself:
1. generate the keystore
2. create `key.properties`
3. build `app-release.aab`
4. upload in Play Console

If you want, the next step I can do is:
1. verify the Android app icons / manifest / package metadata are Play Store-safe
2. build the signed AAB with you once you create `key.properties`
