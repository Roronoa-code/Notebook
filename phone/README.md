# Notebook phone: UI preview

This is a test build of the approved phone design, running on its own with sample items so the look and feel can be tried on the phone. It doesn't save or sync anything yet, and it has no internet permission.

- `app/src/main/assets/www/`: the screens (plain HTML/CSS/JS, fonts and sample images bundled).
- `app/src/main/java/com/mani/notebook/MainActivity.java`: a full-screen WebView that loads those files, with the Android back gesture wired to the page.

## Build and install (Windows)

Gradle can't build from this folder because the path contains "&", so copy the project somewhere without it and build there:

```bash
B="$LOCALAPPDATA/Temp/nbphone-build"; rm -rf "$B"; mkdir -p "$B"
cp -r settings.gradle.kts build.gradle.kts gradle.properties gradle app "$B/"
echo 'sdk.dir=C:/Users/abdul/AppData/Local/Android/Sdk' > "$B/local.properties"
cd "$B" && JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" "C:/Program Files/Android/Android Studio/jbr/bin/java.exe" -cp gradle/wrapper/gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain :app:assembleDebug
"$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe" -s <phone-ip:port> install -r app/build/outputs/apk/debug/app-debug.apk
```

The phone must have Wireless debugging on and be paired with this PC.
