#!/usr/bin/env bash
# Резонанс OS on an Android TV emulator: install as the installer does, make it
# the home screen, press the remote's buttons and photograph the screen.
APK="$1"
OUT=smoke-tv
mkdir -p "$OUT"
PKG=app.rezonans.tv
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
key() { adb shell input keyevent "$1"; sleep "${2:-1.2}"; }

adb wait-for-device
adb shell getprop ro.build.version.release > "$OUT/android.txt"
adb shell dumpsys package com.google.android.webview | grep versionName | head -1 >> "$OUT/android.txt"
adb shell settings put global window_animation_scale 1
adb install -r -g "$APK" > "$OUT/install.txt" 2>&1
cat "$OUT/install.txt"

# what the installer does
adb shell pm grant $PKG android.permission.RECORD_AUDIO
adb shell cmd notification allow_listener $PKG/$PKG.MediaListener
adb shell settings put secure enabled_accessibility_services $PKG/$PKG.HomeGuard
adb shell settings put secure accessibility_enabled 1
adb shell cmd package set-home-activity $PKG/.MainActivity > "$OUT/home.txt" 2>&1
adb shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME >> "$OUT/home.txt" 2>&1

adb logcat -c
key KEYCODE_HOME 1
sleep 9
shot 1-home
key KEYCODE_DPAD_RIGHT
key KEYCODE_DPAD_RIGHT 1.5
shot 2-focus-right
key KEYCODE_DPAD_DOWN 1.5
shot 3-apps-row
key KEYCODE_DPAD_DOWN 1.5
shot 4-tools-row
# the app's menu (Menu key; on a remote without it — hold OK)
key KEYCODE_DPAD_UP 0.8
key KEYCODE_MENU 1.5
shot 5-menu
key KEYCODE_DPAD_DOWN 0.8
shot 5b-menu-down
key KEYCODE_BACK 1
# settings (the tools row: all apps, saver, settings)
key KEYCODE_DPAD_DOWN 0.8
for i in 1 2 3 4 5 6; do adb shell input keyevent KEYCODE_DPAD_LEFT; done
sleep 0.6
key KEYCODE_DPAD_RIGHT 0.6
key KEYCODE_DPAD_RIGHT 0.6
key KEYCODE_DPAD_CENTER 1.8
shot 6-settings
key KEYCODE_DPAD_RIGHT 1.2
shot 7-settings-changed
key KEYCODE_DPAD_LEFT 0.6
key KEYCODE_BACK 1
# all apps
for i in 1 2 3 4 5 6; do adb shell input keyevent KEYCODE_DPAD_LEFT; done
key KEYCODE_DPAD_CENTER 1.8
shot 8-all-apps
key KEYCODE_BACK 1
# open an app from the favourites, then Home must bring Резонанс OS back
key KEYCODE_DPAD_UP 0.8
key KEYCODE_DPAD_UP 0.8
key KEYCODE_DPAD_CENTER 4
shot 9-app-opened
adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" > "$OUT/top-after-open.txt"
key KEYCODE_HOME 3
shot 10-home-again
adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" > "$OUT/top-after-home.txt"
# the box's own home screen opened by someone: the guard brings Резонанс OS back
STOCK=$(adb shell cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME | grep -v "$PKG" | grep "/" | head -1 | tr -d '\r ')
echo "stock: $STOCK" > "$OUT/guard.txt"
if [ -n "$STOCK" ]; then
  adb shell am start -n "$STOCK" >> "$OUT/guard.txt" 2>&1
  sleep 4
  shot 11-after-stock-home
  adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" >> "$OUT/guard.txt"
fi
# the screen saver
key KEYCODE_HOME 2
for i in 1 2 3; do adb shell input keyevent KEYCODE_DPAD_DOWN; done
sleep 0.6
for i in 1 2 3 4 5 6; do adb shell input keyevent KEYCODE_DPAD_LEFT; done
key KEYCODE_DPAD_RIGHT 0.6
key KEYCODE_DPAD_CENTER 3
shot 12-saver
key KEYCODE_DPAD_UP 1.5
adb shell dumpsys meminfo $PKG | head -30 > "$OUT/meminfo.txt"
adb logcat -d -s RezTV:V AndroidRuntime:E > "$OUT/logcat.txt"
echo done
