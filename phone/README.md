# Notebook for Android

Photos, videos, notes and boards are stored on the phone. Pairing with Notebook for Windows enables library sync over the private home network.

Ideas works without pairing: For you, board Ideas, Pinterest search and More like this use native HTTPS requests. Saving downloads the original image or a supported video into the phone library. Cached pictures and downloaded media work offline. The WebView stays blocked from the web; native requests accept only approved Pinterest hosts.

Phone discovery uses public results, recent saves and text matching. The PC additionally uses its signed-in Pinterest home feed and local image models. Phone discovery does not upload library pictures or transfer desktop login cookies.

- `app/src/main/assets/www/`: the screens (plain HTML/CSS/JS, fonts and sample images bundled).
- `app/src/main/java/com/mani/notebook/`: the native library, sync, Pinterest client and local WebView bridge.

## Build and install (Windows)

Use a staging directory without `&`. Copy the project without its build caches and retain the staging directory for incremental builds. From this folder in PowerShell:

```powershell
$stage = Join-Path $env:LOCALAPPDATA 'Temp/nbphone-build'
robocopy . $stage /E /XD build .gradle
$env:JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr'
[IO.File]::WriteAllText((Join-Path $stage 'local.properties'), 'sdk.dir=C:/Users/abdul/AppData/Local/Android/Sdk')
Set-Location -LiteralPath $stage
& "$env:JAVA_HOME/bin/java.exe" -classpath gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain :app:assembleDebug
```

Install `app/build/outputs/apk/debug/app-debug.apk` with `adb -s <explicit-device> install -r`. Always identify the intended device; other attached devices belong to separate projects.

The five interface suites use Edge and the mock bridge. With `NOTEBOOK_TEST_EMULATOR=emulator-<port>`, `scripts/test-phone-ideas-native.ps1` runs the parser and media validation checks on Android, and `scripts/test-phone-discovery.js` tests public search, direct saving and cached browsing after an offline restart. The discovery check needs the current APK installed first. Both checks refuse physical devices.
