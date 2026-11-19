#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const errors = [];
const warnings = [];
const passed = [];

function check(label, condition, detail) {
  if (condition) {
    passed.push(label);
  } else {
    errors.push(`${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function warn(label, detail) {
  warnings.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function readPngDimensions(relPath) {
  const buf = fs.readFileSync(path.join(ROOT, relPath));
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") {
    return null;
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bytes: buf.length,
  };
}

// 1. Package & Capacitor identity consistency
const pkg = JSON.parse(readText("package.json"));
const capConfig = readText("capacitor.config.ts");
const gradleApp = readText("android/app/build.gradle");
const gradleVars = readText("android/variables.gradle");
const manifest = readText("android/app/src/main/AndroidManifest.xml");
const stringsXml = readText("android/app/src/main/res/values/strings.xml");

check("package.json version is semver release (>= 1.0.0)", /^([1-9]\d*)\.\d+\.\d+$/.test(pkg.version), `found "${pkg.version}"`);
check("Capacitor appId is app.noi.vietnamese", capConfig.includes('appId: "app.noi.vietnamese"'));
check("Capacitor webContentsDebuggingEnabled is false", capConfig.includes("webContentsDebuggingEnabled: false"));
check("Capacitor allowMixedContent is false", capConfig.includes("allowMixedContent: false"));
check("Gradle applicationId matches app.noi.vietnamese", gradleApp.includes('applicationId "app.noi.vietnamese"'));
check("Gradle R8 minifyEnabled & shrinkResources enabled", gradleApp.includes("minifyEnabled true") && gradleApp.includes("shrinkResources true"));
check("Gradle release signing config present", gradleApp.includes("signingConfigs") && gradleApp.includes("enableV2Signing true"));

// 2. Android SDK & Play Policy API level compliance
const targetSdkMatch = gradleVars.match(/targetSdkVersion\s*=\s*(\d+)/);
const minSdkMatch = gradleVars.match(/minSdkVersion\s*=\s*(\d+)/);
const targetSdk = targetSdkMatch ? Number(targetSdkMatch[1]) : 0;
const minSdk = minSdkMatch ? Number(minSdkMatch[1]) : 0;
check("targetSdkVersion >= 35 (Google Play requirement)", targetSdk >= 35, `found ${targetSdk}`);
check("minSdkVersion >= 24", minSdk >= 24, `found ${minSdk}`);

// 3. AndroidManifest security & compliance
check("Cleartext traffic disabled in AndroidManifest.xml", manifest.includes('android:usesCleartextTraffic="false"'));
check("Network security config linked", manifest.includes('android:networkSecurityConfig="@xml/network_security_config"'));
check("Backup & data extraction rules configured", manifest.includes("@xml/backup_rules") && manifest.includes("@xml/data_extraction_rules"));
check("Microphone hardware marked optional (required=false)", manifest.includes('android:name="android.hardware.microphone"') && manifest.includes('android:required="false"'));
check("No AD_ID permission declared (ad-free app)", !manifest.includes("AD_ID"));
check("Android app_name set to Nói", stringsXml.includes("<string name=\"app_name\">Nói</string>"));
check("Adaptive icon + Android 13+ monochrome icon configured", readText("android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml").includes("<monochrome"));
check("Android 12+ SplashScreen theme configured (values-v31)", exists("android/app/src/main/res/values-v31/styles.xml"));

// 4. Privacy Policy & Digital Asset Links
check("Privacy policy HTML present", exists("public/privacy.html"));
check("Privacy policy contains developer contact email", readText("public/privacy.html").includes("mailto:"));
check("Digital Asset Links template present", exists("public/.well-known/assetlinks.json"));

// 5. No bloated unused source PNGs in public/ or Android assets
const publicFiles = fs.readdirSync(path.join(ROOT, "public"));
const oversizedPublic = publicFiles.filter((f) => {
  const full = path.join(ROOT, "public", f);
  return fs.statSync(full).isFile() && fs.statSync(full).size > 1024 * 1024;
});
check("No >1 MB unoptimized files in public/", oversizedPublic.length === 0, oversizedPublic.join(", "));

check("Android web assets synced (index.html)", exists("android/app/src/main/assets/public/index.html"));
check("Android web assets include dialect icons", exists("android/app/src/main/assets/public/northern-vietnam-icon-96.png") && exists("android/app/src/main/assets/public/central-vietnam-icon-96.png") && exists("android/app/src/main/assets/public/southern-vietnam-icon-96.png"));

// 6. Google Play Console graphic assets dimensions & limits
const iconDim = exists("play-store/assets/app-icon-512x512.png") ? readPngDimensions("play-store/assets/app-icon-512x512.png") : null;
check("Play Store App Icon is 512x512 PNG <= 1 MB", Boolean(iconDim && iconDim.width === 512 && iconDim.height === 512 && iconDim.bytes <= 1024 * 1024), iconDim ? `${iconDim.width}x${iconDim.height}, ${iconDim.bytes}B` : "missing");

const featDim = exists("play-store/assets/feature-graphic-1024x500.png") ? readPngDimensions("play-store/assets/feature-graphic-1024x500.png") : null;
check("Play Store Feature Graphic is 1024x500 PNG <= 15 MB", Boolean(featDim && featDim.width === 1024 && featDim.height === 500 && featDim.bytes <= 15 * 1024 * 1024), featDim ? `${featDim.width}x${featDim.height}, ${featDim.bytes}B` : "missing");

const screenshotsDir = path.join(ROOT, "play-store/assets/screenshots");
const screenshotFiles = exists("play-store/assets/screenshots")
  ? fs.readdirSync(screenshotsDir).filter((f) => f.endsWith(".png")).sort()
  : [];
check("At least 2 Play Store phone screenshots present", screenshotFiles.length >= 2, `found ${screenshotFiles.length}`);
for (const file of screenshotFiles) {
  const dim = readPngDimensions(path.join("play-store/assets/screenshots", file));
  check(`Screenshot ${file} is 1080x1920 PNG`, Boolean(dim && dim.width === 1080 && dim.height === 1920), dim ? `${dim.width}x${dim.height}` : "invalid");
}

// 7. Google Play Console listing character limits
const title = readText("play-store/listing/en-US/title.txt").trim();
const shortDesc = readText("play-store/listing/en-US/short_description.txt").trim();
const fullDesc = readText("play-store/listing/en-US/full_description.txt").trim();
const changelog = readText("play-store/listing/en-US/changelogs/1.txt").trim();

check(`Play title <= 30 chars (${title.length}/30)`, title.length > 0 && title.length <= 30);
check(`Play short description <= 80 chars (${shortDesc.length}/80)`, shortDesc.length > 0 && shortDesc.length <= 80);
check(`Play full description <= 4000 chars (${fullDesc.length}/4000)`, fullDesc.length > 0 && fullDesc.length <= 4000);
check(`Play changelog v1 <= 500 chars (${changelog.length}/500)`, changelog.length > 0 && changelog.length <= 500);

// 8. GitHub Actions workflow sanity check
const workflow = readText(".github/workflows/android-release.yml");
check("GitHub Actions android-release.yml has no broken nested ${{ }} expression", !workflow.includes("'${{"));

// 9. Environment reminders (non-fatal warnings)
if (!exists("android/keystore.properties")) {
  warn("Upload keystore not yet created locally", "Run ./scripts/generate-upload-keystore.sh on your machine (or configure GitHub Secrets)");
}
if (readText("public/.well-known/assetlinks.json").includes("REPLACE_WITH_GOOGLE_PLAY")) {
  warn("assetlinks.json has placeholder SHA-256 fingerprint", "Update ANDROID_SHA256_FINGERPRINTS after enrolling in Play App Signing");
}

console.warn(`\nGoogle Play Readiness Audit: ${passed.length} passed, ${warnings.length} reminders, ${errors.length} failed.`);
for (const w of warnings) {
  console.warn(`  [REMINDER] ${w}`);
}
for (const e of errors) {
  console.error(`  [FAIL] ${e}`);
}
if (errors.length > 0) {
  process.exit(1);
}
console.warn("  All automated Google Play readiness checks passed!\n");
