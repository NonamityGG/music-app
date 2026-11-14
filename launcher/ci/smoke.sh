#!/usr/bin/env bash
# Резонанс Лаунчер on a phone emulator: installed, made the home screen, touched
# the way a hand does (swipe up, search, long presses), the screen photographed.
APK="$1"
OUT=smoke-launcher
mkdir -p "$OUT"
PKG=app.rezonans.launcher
shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
key() { adb shell input keyevent "$1"; sleep "${2:-1.2}"; }
size=$(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | tail -1)
W=${size%x*}; H=${size#*x}
X=$((W / 2))

adb wait-for-device
adb shell getprop ro.build.version.release > "$OUT/android.txt"
adb shell dumpsys package com.google.android.webview | grep versionName | head -1 >> "$OUT/android.txt"
adb install -r -g "$APK" > "$OUT/install.txt" 2>&1
cat "$OUT/install.txt"
# an emulator only: on a real phone the person chooses the home app
adb shell cmd package set-home-activity $PKG/.MainActivity > "$OUT/home.txt" 2>&1
adb shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME >> "$OUT/home.txt" 2>&1

adb logcat -c
adb shell am start -a android.intent.action.MAIN -c android.intent.category.HOME -n $PKG/.MainActivity
sleep 8
shot 1-home
# swipe up: the drawer follows the finger
adb shell input swipe $X $((H * 75 / 100)) $X $((H * 25 / 100)) 350
sleep 1.5
shot 2-drawer
# search: the field is at the top of the drawer
adb shell input tap $X $((H * 9 / 100))
sleep 1
adb shell input text "set"
sleep 1.2
shot 3-search
key KEYCODE_BACK 0.8
key KEYCODE_BACK 1.2
shot 4-home-again
# a long press on an icon of the home grid (the second row from the dock up)
adb shell input swipe $((W / 8)) $((H * 66 / 100)) $((W / 8)) $((H * 66 / 100)) 900
sleep 1.2
shot 5-long-icon
key KEYCODE_BACK 1
# a long press on an empty place: the settings
adb shell input swipe $X $((H * 30 / 100)) $X $((H * 30 / 100)) 900
sleep 1.4
shot 6-settings
key KEYCODE_BACK 1
key KEYCODE_HOME 2
shot 7-home-pressed

adb logcat -d -s RezL:* > "$OUT/rezl.txt"
adb logcat -d -s chromium:* AndroidRuntime:* | tail -80 > "$OUT/logcat.txt"
adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" > "$OUT/top.txt"
