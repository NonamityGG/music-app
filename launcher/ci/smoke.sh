#!/usr/bin/env bash
# Резонанс Лаунчер on a phone emulator: installed, made the home screen, touched
# the way a hand does (swipes, a long press), the screen photographed.
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
adb shell pm grant $PKG android.permission.RECORD_AUDIO
adb shell cmd package set-home-activity $PKG/.MainActivity > "$OUT/home.txt" 2>&1
adb shell cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME >> "$OUT/home.txt" 2>&1

adb logcat -c
adb shell am start -n $PKG/.MainActivity
sleep 4
shot 0-intro
sleep 12
shot 1-home
key KEYCODE_HOME 2
shot 2-home-pressed
# swipe up: the drawer
adb shell input swipe $X $((H * 80 / 100)) $X $((H * 20 / 100)) 300
sleep 1.5
shot 3-drawer
key KEYCODE_BACK 1.2
# long press on the empty place and on an icon
adb shell input swipe $X $((H * 45 / 100)) $X $((H * 45 / 100)) 900
sleep 1.2
shot 4-long-empty
key KEYCODE_BACK 1
adb shell input swipe $((W / 8 * 3)) $((H * 40 / 100)) $((W / 8 * 3)) $((H * 40 / 100)) 900
sleep 1.2
shot 5-long-icon
key KEYCODE_BACK 1
# sideways: the page of the day
adb shell input swipe $((W * 85 / 100)) $((H / 2)) $((W * 10 / 100)) $((H / 2)) 250
sleep 1
shot 6-page-right
adb shell input swipe $((W * 10 / 100)) $((H / 2)) $((W * 85 / 100)) $((H / 2)) 250
sleep 1
adb shell input swipe $((W * 10 / 100)) $((H / 2)) $((W * 85 / 100)) $((H / 2)) 250
sleep 1
shot 7-page-left
# what the page and the system said
adb logcat -d -s RezL:* > "$OUT/rezl.txt"
adb logcat -d -s chromium:* AndroidRuntime:* | tail -80 > "$OUT/logcat.txt"
adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" > "$OUT/top.txt"
