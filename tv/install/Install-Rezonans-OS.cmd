@echo off
rem Rezonans OS installer for TV boxes (SberBox and other Android TV).
rem Run it from the folder with the Rezonans-OS-*.apk file. Everything below
rem the PSSTART line is PowerShell.
chcp 65001 >nul
set "REZ_HERE=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText('%~f0',[Text.Encoding]::UTF8); $i=$s.IndexOf('#'+'PSSTART'); Invoke-Expression $s.Substring($i)"
echo.
pause
exit /b
#PSSTART
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Host.UI.RawUI.WindowTitle = 'Резонанс OS — установка на телевизор'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Step($text) { Write-Host ''; Write-Host "  $text" -ForegroundColor Magenta }
function Fail($text) { Write-Host ''; Write-Host "  $text" -ForegroundColor Red; exit 1 }

# adb writes its messages to stderr; Windows PowerShell would take them for
# errors and stop. Run it with its output as plain text.
function A {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $o = & $adb @args 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $old }
  return (($o -join "`n").Trim())
}

# the TV announces itself in the network while "Отладка по Wi-Fi" is on
function Announced([string]$kind) {
  $m = [regex]::Match((A mdns services), "_adb-tls-$kind\._tcp\.?\s+(\d+\.\d+\.\d+\.\d+:\d+)")
  if ($m.Success) { return $m.Groups[1].Value }
  return ''
}

$here = $env:REZ_HERE
$work = Join-Path $env:LOCALAPPDATA 'RezonansOS'
New-Item -ItemType Directory -Force $work | Out-Null
$pkg = 'app.rezonans.tv'

Write-Host ''
Write-Host '  ┃┃┃ Резонанс OS' -ForegroundColor Magenta
Say '  Домашний экран для телевизора. Компьютер и приставка должны быть в одной сети.'
Say '  На приставке должна быть включена отладка по сети (ADB) — см. описание в релизе.'

# ---------- adb ----------
Step '1. Программа для связи с приставкой (adb)'
$adb = Join-Path $work 'platform-tools\adb.exe'
if (-not (Test-Path $adb)) {
  Say '  Скачиваю Android Platform-Tools от Google (~7 МБ)…'
  $zip = Join-Path $work 'platform-tools.zip'
  Invoke-WebRequest -UseBasicParsing 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip
  Expand-Archive -Force $zip $work
  Remove-Item $zip
}
if (-not (Test-Path $adb)) { Fail 'Не получилось скачать adb. Проверь интернет и запусти ещё раз.' }
Say '  Готово.' 'Green'

# ---------- the app ----------
Step '2. Резонанс OS'
$apk = Get-ChildItem -Path $here -Filter 'Rezonans-OS-*.apk' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $apk) {
  Say '  Файла Rezonans-OS-*.apk рядом нет — скачиваю последнюю версию с GitHub…'
  $rel = Invoke-RestMethod -UseBasicParsing 'https://api.github.com/repos/NonamityGG/music-app/releases?per_page=30' -Headers @{ 'User-Agent' = 'RezonansOS-installer' }
  $tv = $rel | Where-Object { $_.tag_name -like 'tv-v*' } | Select-Object -First 1
  if (-not $tv) { Fail 'Не нашёл выпуск Резонанс OS на GitHub.' }
  $asset = $tv.assets | Where-Object { $_.name -like '*.apk' } | Select-Object -First 1
  $path = Join-Path $work $asset.name
  Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $path
  $apk = Get-Item $path
}
Say ('  ' + $apk.Name) 'Green'

# ---------- the box ----------
Step '3. Приставка'
Say '  Включи отладку на телевизоре (один раз):'
Say '    Настройки → Об устройстве → 7 раз нажми «Номер сборки» (появится «Вы стали разработчиком»),'
Say '    потом Настройки → «Для разработчиков» → включи «Отладка по Wi-Fi».'
Say '  В «Отладка по Wi-Fi» написан адрес вида 192.168.1.45:37099 — введи его целиком.'
Say '  (Если включал ADB через Sber Studio — хватит просто IP из Настройки → Сеть.)'
$ipFile = Join-Path $work 'tv-ip.txt'
$last = ''
if (Test-Path $ipFile) { $last = (Get-Content $ipFile -Raw).Trim() }
A start-server | Out-Null
$seen = Announced 'connect'
if ($seen) {
  Say "  Нашёл телевизор в сети: $seen" 'Green'
  $last = $seen
}
$prompt = '  Адрес'
if ($last) { $prompt += " [Enter — $last]" }
$ip = (Read-Host $prompt).Trim()
if (-not $ip) { $ip = $last }
if (-not $ip) { Fail 'Без адреса приставки не получится.' }
$ip = $ip -replace '\s', ''
Set-Content -Path $ipFile -Value $ip -Encoding ASCII
$target = if ($ip -match ':\d+$') { $ip } else { "${ip}:5555" }

function TryConnect([int]$tries) {
  A disconnect $target | Out-Null
  for ($try = 1; $try -le $tries; $try++) {
    $r = A connect $target
    $state = A -s $target get-state
    if ($state -eq 'device') { return $true }
    if ($r -match 'unauthorized' -or $state -match 'unauthorized') {
      Say '  На экране телевизора вопрос про отладку — выбери «Разрешить» (лучше «Всегда с этого компьютера»).' 'Yellow'
    } elseif ($try -eq 1) {
      Say "  Пока не отвечает ($r)…" 'Yellow'
    }
    Start-Sleep -Seconds 3
  }
  return $false
}

Say "  Подключаюсь к $target…"
$ok = TryConnect 4
if (-not $ok) {
  # Android 11+: the computer has to be paired once with a code from the TV
  Write-Host ''
  Say '  Нужно один раз связать компьютер с телевизором по коду.' 'Yellow'
  Say '  На телевизоре в «Отладка по Wi-Fi» выбери «Подключить устройство с помощью кода» (или «…по коду подключения»).'
  Say '  Там будут адрес с портом и шестизначный код.'
  Read-Host '  Когда окно с кодом откроется — нажми Enter' | Out-Null
  $pairSeen = Announced 'pairing'
  $pairPrompt = '  Адрес и порт из этого окна (например 192.168.1.45:41234)'
  if ($pairSeen) { $pairPrompt += " [Enter — $pairSeen]" }
  $pairAddr = (Read-Host $pairPrompt).Trim() -replace '\s', ''
  if (-not $pairAddr) { $pairAddr = $pairSeen }
  $code = (Read-Host '  Код').Trim() -replace '\s', ''
  if ($pairAddr -and $code) {
    $pr = A pair $pairAddr $code
    Say "  $pr"
    if ($pr -notmatch 'Successfully') { Fail 'Связать не получилось: проверь адрес и код (код меняется, если окно закрыть).' }
    # after pairing the TV is usually found by itself
    Start-Sleep -Seconds 2
    $again = Announced 'connect'
    if ($again) { $target = $again }
    $found = (A devices) -split "`n" | Where-Object { $_ -match '^\S+\s+device\s*$' } | ForEach-Object { ($_ -split '\s+')[0] } | Select-Object -First 1
    if ($found) { $target = $found }
    $ok = TryConnect 10
  }
}
if (-not $ok -and $seen -and $seen -ne $target) {
  Say "  По введённому адресу не отвечает, пробую найденный: $seen" 'Yellow'
  $target = $seen
  $ok = TryConnect 4
}
if (-not $ok) { Fail 'Приставка не ответила. Проверь, что «Отладка по Wi-Fi» включена, адрес верный (с портом), компьютер и телевизор в одной сети и VPN выключен.' }
$model = A -s $target shell getprop ro.product.model
Say "  Подключено: $model" 'Green'

function Shell([string]$cmd) { A -s $target shell $cmd }

# ---------- install ----------
Step '4. Установка'
$out = A -s $target install -r -g $apk.FullName
if ($out -notmatch 'Success') {
  # older Android has no -g
  $out = A -s $target install -r $apk.FullName
}
if ($out -notmatch 'Success') { Fail "Приставка не приняла установку: $out" }
Say '  Резонанс OS установлен.' 'Green'

Step '5. Разрешения'
Shell "pm grant $pkg android.permission.RECORD_AUDIO" | Out-Null
Say '  Звук для волн: выдано.'
$r = Shell "cmd notification allow_listener $pkg/$pkg.MediaListener"
if ($r) { Say "  «Сейчас играет»: $r" 'Yellow' } else { Say '  «Сейчас играет»: выдано.' }
$svc = "$pkg/$pkg.HomeGuard"
$cur = Shell 'settings get secure enabled_accessibility_services'
if ($cur -notlike "*$svc*") {
  $new = if ($cur -and $cur -ne 'null') { "${cur}:$svc" } else { $svc }
  Shell "settings put secure enabled_accessibility_services $new" | Out-Null
}
Shell 'settings put secure accessibility_enabled 1' | Out-Null
Say '  Кнопка «Домой» → Резонанс OS: включено.'

Step '6. Домашний экран'
$r = Shell "cmd package set-home-activity $pkg/.MainActivity"
Say ('  ' + ($(if ($r) { $r } else { 'Резонанс OS — домашний экран.' })))
Shell "am start -n $pkg/.MainActivity" | Out-Null

Write-Host ''
Write-Host '  Готово! Посмотри на телевизор.' -ForegroundColor Green
Say '  Настройки Резонанс OS — в ряду «Резонанс OS» внизу главного экрана.'
Say '  Вернуть экран Сбера: Restore-Sber-Home.cmd.'
