# Nói — Google Play Console Publishing Guide

Everything that can be prepared from this development environment is complete and verified. Follow the steps below to generate your upload signing key, build the signed `.aab`, and submit **Nói** (`app.noi.vietnamese`) in Google Play Console.

---

## 1. What Is Already Completed & Verified

- **Android Native Project (`android/`)**:
  - Application ID: `app.noi.vietnamese`
  - SDK targets: `minSdk 24` (Android 7.0+), `compileSdk 36`, `targetSdk 36` (Android 16 — meets Google Play's latest API level requirement)
  - Release shrinking: `minifyEnabled true`, `shrinkResources true`, hardened Capacitor 8 R8/ProGuard rules (`android/app/proguard-rules.pro`)
  - Signing config: V1–V4 signing enabled with fail-fast `requireReleaseSigning` guard
  - Security: `usesCleartextTraffic="false"` + strict `network_security_config.xml` (HTTPS only)
  - Android 12–16 backup rules: `backup_rules.xml` & `data_extraction_rules.xml`
  - Android 12+ SplashScreen API (`values-v31/styles.xml` + `drawable/splash_icon.xml`) & crisp rounded splash screens for all densities
  - Adaptive launcher icons (`drawable/ic_launcher_foreground.xml`), Android 13+ Material You monochrome icon (`drawable/ic_launcher_monochrome.xml`), and antialiased legacy mipmaps (`mdpi`–`xxxhdpi`)
  - Native Capacitor bridge (`NoiAndroidPlugin.java`) for Android TTS, audio focus, speech recognition, and runtime `RECORD_AUDIO` permission
  - Web bundle freshly built and synced into `android/app/src/main/assets/public/` (~1.5 MB; 10.2 MB of unused source images moved out of `public/` into `assets-source/`)
- **Google Play Store Graphic Assets (`play-store/assets/`)**:
  - `play-store/assets/app-icon-512x512.png` — 512×512 px, 32-bit opaque PNG
  - `play-store/assets/feature-graphic-1024x500.png` — 1024×500 px, 24-bit opaque PNG
  - `play-store/assets/screenshots/01-study-deck-dialects.png` — 1080×1920 px (9:16)
  - `play-store/assets/screenshots/02-tone-coach.png` — 1080×1920 px (9:16)
  - `play-store/assets/screenshots/03-phrase-library.png` — 1080×1920 px (9:16)
  - `play-store/assets/screenshots/04-offline-translator.png` — 1080×1920 px (9:16)
- **Store Listing Metadata (`play-store/listing/en-US/`)**:
  - `title.txt` (23 / 30 chars)
  - `short_description.txt` (67 / 80 chars)
  - `full_description.txt` (within 4,000-char limit)
  - `changelogs/1.txt` (within 500-char limit)
- **Privacy Policy & Compliance**:
  - Hosted static page at `/privacy` (`public/privacy.html`) and in-app modal inside Settings (`v1.0.0`)
  - Developer contact: `wiltermoodj@gmail.com`
- **CI/CD & Local Release Automation**:
  - Fixed GitHub Actions release workflow: `.github/workflows/android-release.yml` (builds signed `.aab` + uploads R8 `mapping.txt`)
  - Local keystore generator: `scripts/generate-upload-keystore.sh`
  - Local signed AAB builder: `scripts/build-play-release.sh`
  - Automated readiness checker: `npm run play:verify`

---

## 2. Create Your Upload Keystore (One-Time Setup)

> **Important:** Because Java / Android SDK are not preinstalled in the cloud sandbox, run this step once on your local machine (with JDK 21 or Android Studio installed) OR keep your existing upload keystore if you already have one. **Back up the `.jks` file and passwords in a password manager — never commit them to Git.**

```bash
chmod +x scripts/generate-upload-keystore.sh
./scripts/generate-upload-keystore.sh
```

This creates:
- `~/noi-upload-key.jks` (your upload signing key, valid 10,000 days)
- `android/keystore.properties` (git-ignored)
- Prints the Base64 string and values to paste into GitHub Secrets if you build via GitHub Actions.

---

## 3. Build the Signed Android App Bundle (`.aab`)

You have **two** ready-to-use build paths:

### Option A: GitHub Actions (No Local Android Studio Required)

1. Push this repository to GitHub.
2. In GitHub → **Settings → Secrets and variables → Actions → Secrets**, add:
   - `ANDROID_KEYSTORE_BASE64` — Base64 output from `generate-upload-keystore.sh`
   - `ANDROID_KEYSTORE_PASSWORD` — your keystore password
   - `ANDROID_KEY_ALIAS` — `noi-upload`
   - `ANDROID_KEY_PASSWORD` — your key password
3. *(Optional)* If you want Cloud Regional Vietnamese TTS enabled in the native Android app, add a Repository **Variable** (`Settings → Secrets and variables → Actions → Variables`):
   - `VITE_API_BASE_URL` = your deployed HTTPS backend URL (for example, your Cloud Run URL without a trailing slash). Leave blank for a 100% offline on-device Android TTS build.
4. Go to **Actions → Android Google Play Release → Run workflow**:
   - `version_name`: `1.0.0`
   - `version_code`: `1`
   - `require_signing`: `true`
5. Download the **`noi-play-store-release-v1.0.0-b1`** artifact containing:
   - `app-release.aab` (upload this to Google Play Console)
   - `mapping.txt` (optional backup; AGP also embeds R8 mapping into the `.aab`)

### Option B: Local Machine / Android Studio (JDK 21 + Android SDK 36)

```bash
chmod +x scripts/build-play-release.sh
# Offline-first build (on-device Android TTS):
./scripts/build-play-release.sh 1.0.0 1

# Or with hosted Regional Vietnamese Cloud TTS backend:
VITE_API_BASE_URL="https://your-deployed-noi-backend.run.app" ./scripts/build-play-release.sh 1.0.0 1
```

Output bundle: `android/app/build/outputs/bundle/release/app-release.aab`.

---

## 4. Google Play Console Setup (Copy-Paste Checklist)

### Step A: Create App
1. Open [Google Play Console](https://play.google.com/console) → **Create app**.
2. **App name**: `Nói — Spoken Vietnamese`
3. **Default language**: `English (United States) – en-US`
4. **App or game**: `App`
5. **Free or paid**: `Free`
6. Accept Developer Program Policies and US export laws → **Create app**.

### Step B: Set Up Your App (Dashboard → App Content)
Use `play-store/data-safety-answers.json` for exact answers:
1. **Privacy policy**: Enter your live HTTPS privacy policy URL ending in `/privacy` (e.g., `https://ais-pre-n4cyovfaaeyp7hz6qzxinn-353902763030.us-east1.run.app/privacy` or your custom domain `/privacy`).
2. **App access**: Select **All functionality in my app is available without any access restrictions**.
3. **Ads**: Select **No, my app does not contain ads**.
4. **Content rating (IARC)**:
   - Email: `wiltermoodj@gmail.com`
   - Category: **Reference, News, or Educational**
   - Answer **No** to violence, sexuality, offensive language, controlled substances, gambling, and unrestricted user-to-user interaction → Expected rating: **Everyone / PEGI 3**.
5. **Target audience and content**:
   - Recommended age groups: **13–15, 16–17, 18 and over** (avoids Families Policy delays while allowing broad adoption).
   - Could your store listing unintentionally appeal to children? **No**.
6. **News apps / COVID-19 / Government / Financial / Health**: Select **No / None** for each.
7. **Advertising ID**: Select **No** (the app does not include `AD_ID` or ad SDKs).
8. **Data safety**:
   - **If built WITHOUT `VITE_API_BASE_URL` (100% offline build)**:
     - Does your app collect or share any of the required user data types? → **No**.
   - **If built WITH `VITE_API_BASE_URL` (Cloud Regional TTS enabled)**:
     - Does your app collect or share any of the required user data types? → **Yes**
     - Is all of the user data collected by your app encrypted in transit? → **Yes**
     - Do you provide a way for users to request that their data is deleted? → **No account required** (select local deletion / no account created).
     - Data type: **App activity / Other user-generated content** → **Collected**, **Not shared**, **Processed ephemerally: Yes**, **Optional: Yes** (users can switch to On-Device Vietnamese Only in Settings), **Purpose: App functionality**.

### Step C: Main Store Listing (Grow → Store presence → Main store listing)
1. **App name**: Copy from `play-store/listing/en-US/title.txt` (`Nói — Spoken Vietnamese`)
2. **Short description**: Copy from `play-store/listing/en-US/short_description.txt`
3. **Full description**: Copy from `play-store/listing/en-US/full_description.txt`
4. **App icon**: Upload `play-store/assets/app-icon-512x512.png`
5. **Feature graphic**: Upload `play-store/assets/feature-graphic-1024x500.png`
6. **Phone screenshots**: Upload the 4 PNGs in `play-store/assets/screenshots/` (or replace with raw device captures from Android Emulator if you prefer).
7. **Store settings** (Grow → Store presence → Store settings):
   - **App category**: `Education`
   - **Tags**: `Language`, `Education`, `Travel & Local`
   - **Contact email**: `wiltermoodj@gmail.com`

### Step D: Upload `.aab` & Release Tracks
1. **Play App Signing**: On first release, accept **Google Play App Signing** (required for all new Play Store apps).
2. **Recommended rollout order**:
   - **Internal testing**: Upload `app-release.aab`, copy release notes from `play-store/listing/en-US/changelogs/1.txt`, add your test email, install via the Play Store opt-in link, and verify audio, microphone permissions, offline mode, and back navigation on a real Android device.
   - **Closed testing** *(required for personal Google Play developer accounts created after Nov 2023)*: Enroll at least **12 opted-in testers** continuously for **14 days** before applying for Production access.
   - **Production**: Promote your verified release from Closed Testing to Production!

### Step E: Configure Digital Asset Links (After First Play Upload)
1. In Google Play Console → **Test and release → Setup → App signing**, copy the **App signing key certificate SHA-256 fingerprint**.
2. Set `ANDROID_SHA256_FINGERPRINTS` in your deployed server environment (and optionally update `public/.well-known/assetlinks.json`).
3. Verify `https://<your-domain>/.well-known/assetlinks.json` returns your real SHA-256 fingerprint.
