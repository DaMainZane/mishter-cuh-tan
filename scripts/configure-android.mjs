// scripts/configure-android.mjs
// Patches the Capacitor-generated `android/` project with:
// 1. versionName & versionCode synced from package.json
// 2. Immersive fullscreen MainActivity (system bars hidden + transient swipe + display cutout shortEdges)
// 3. Matching sea-blue adaptive launcher icon assets from public/icon-*.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(root, 'android');
if (!fs.existsSync(androidDir)) {
  console.error('android/ directory not found. Run `npx cap add android` first.');
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = String(pkg.version || '1.0.0');
const [maj = 1, min = 0, pat = 0] = version.split('.').map(n => Number.parseInt(n, 10) || 0);
const versionCode = maj * 10000 + min * 100 + pat;

// 1. Sync versionCode & versionName in android/app/build.gradle
const appGradlePath = path.join(androidDir, 'app', 'build.gradle');
let appGradle = fs.readFileSync(appGradlePath, 'utf8');
appGradle = appGradle
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
fs.writeFileSync(appGradlePath, appGradle, 'utf8');
console.log(`Updated android/app/build.gradle -> versionName="${version}", versionCode=${versionCode}`);

// 2. Write immersive fullscreen MainActivity.java
const mainActivityPath = path.join(
  androidDir,
  'app',
  'src',
  'main',
  'java',
  'com',
  'colonistcustom',
  'hexsettlers',
  'MainActivity.java'
);
fs.mkdirSync(path.dirname(mainActivityPath), { recursive: true });
const mainActivityJava = `package com.colonistcustom.hexsettlers;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        enableImmersiveFullscreen();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableImmersiveFullscreen();
        }
    }

    private void enableImmersiveFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
            controller.hide(WindowInsetsCompat.Type.systemBars());
        }
    }
}
`;
fs.writeFileSync(mainActivityPath, mainActivityJava, 'utf8');
console.log('Configured immersive fullscreen MainActivity.java');

// 3. Apply Colonist Custom launcher icon & sea-blue background
const resDir = path.join(androidDir, 'app', 'src', 'main', 'res');
const bgXmlPath = path.join(resDir, 'values', 'ic_launcher_background.xml');
if (fs.existsSync(bgXmlPath)) {
  const bgXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#6F9FB0</color>
</resources>
`;
  fs.writeFileSync(bgXmlPath, bgXml, 'utf8');
}

const icon192 = path.join(root, 'public', 'icon-192.png');
const icon512 = path.join(root, 'public', 'icon-512.png');
if (fs.existsSync(icon192) && fs.existsSync(icon512)) {
  const densities = [
    { dir: 'mipmap-mdpi', src: icon192 },
    { dir: 'mipmap-hdpi', src: icon192 },
    { dir: 'mipmap-xhdpi', src: icon192 },
    { dir: 'mipmap-xxhdpi', src: icon512 },
    { dir: 'mipmap-xxxhdpi', src: icon512 }
  ];
  for (const { dir, src } of densities) {
    const targetDir = path.join(resDir, dir);
    if (!fs.existsSync(targetDir)) continue;
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      fs.copyFileSync(src, path.join(targetDir, name));
    }
  }
  console.log('Applied Colonist Custom launcher icons to Android mipmap folders');
}
