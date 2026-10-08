# My Music — Android app

A thin native shell (WebView) around `https://bot.text.bz/listen`, plus a foreground
service + MediaSession so playback continues with the screen off and shows
lock-screen / notification / headset controls. All player logic lives in the web app.

Build (needs JDK 17+, Gradle 8.7+, Android SDK platform 34 + build-tools 34):

    echo "sdk.dir=$ANDROID_HOME" > android/local.properties
    cd android && gradle assembleRelease
    cp app/build/outputs/apk/release/app-release.apk ../public/downloads/MyMusic.apk

`music-release.jks` is a personal sideload signing key (not a store key). Keep using it:
an APK signed with a different key can only replace this one after uninstalling.
Commit the new APK: the server sends every distinct `public/downloads/MyMusic.apk` to the owner in Telegram automatically (deploy/auto-deploy.sh → apk_selfheal).
Bump `versionCode` in `app/build.gradle` for every release you want phones to accept as an update.
