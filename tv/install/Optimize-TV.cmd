@echo off
rem Rezonans OS: safe speed-up for a TV box (SberBox and other Android TV)
rem over "Отладка по Wi-Fi". Nothing here touches the firmware; everything can
rem be undone in the TV's settings. Everything below the PSSTART line is PowerShell.
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
$Host.UI.RawUI.WindowTitle = 'Резонанс OS — ускорение телевизора'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Step($text) { Write-Host ''; Write-Host "  $text" -ForegroundColor Magenta }
function Fail($text) { Write-Host ''; Write-Host "  $text" -ForegroundColor Red; exit 1 }

function A {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $o = & $adb @args 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $old }
  return (($o -join "`n").Trim())
}

function Announced([string]$kind) {
  $m = [regex]::Match((A mdns services), "_adb-tls-$kind\._tcp\.?\s+(\d+\.\d+\.\d+\.\d+:\d+)")
  if ($m.Success) { return $m.Groups[1].Value }
  return ''
}

$work = Join-Path $env:LOCALAPPDATA 'RezonansOS'
New-Item -ItemType Directory -Force $work | Out-Null

Write-Host ''
Write-Host '  ┃┃┃ Резонанс OS — ускорение телевизора' -ForegroundColor Magenta
Say '  Только безопасное: прошивка не меняется, всё возвращается в настройках телевизора.'

# ---------- adb ----------
Step '1. Связь с приставкой'
$adb = Join-Path $work 'platform-tools\adb.exe'
if (-not (Test-Path $adb)) {
  Say '  Скачиваю Android Platform-Tools от Google (~7 МБ)…'
  $zip = Join-Path $work 'platform-tools.zip'
  Invoke-WebRequest -UseBasicParsing 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip' -OutFile $zip
  Expand-Archive -Force $zip $work
  Remove-Item $zip
}
if (-not (Test-Path $adb)) { Fail 'Не получилось скачать adb. Проверь интернет и запусти ещё раз.' }

Say '  На телевизоре: Настройки → «Для разработчиков» → «Отладка по Wi-Fi» должна быть включена.'
$ipFile = Join-Path $work 'tv-ip.txt'
$last = ''
if (Test-Path $ipFile) { $last = (Get-Content $ipFile -Raw).Trim() }
A start-server | Out-Null
$seen = Announced 'connect'
if ($seen) {
  Say "  Нашёл телевизор в сети: $seen" 'Green'
  $last = $seen
}
$prompt = '  Адрес из «Отладка по Wi-Fi»'
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
      Say '  На экране телевизора вопрос про отладку — выбери «Разрешить».' 'Yellow'
    } elseif ($try -eq 1) {
      Say "  Пока не отвечает ($r)…" 'Yellow'
    }
    Start-Sleep -Seconds 3
  }
  return $false
}

$ok = TryConnect 4
if (-not $ok) {
  Write-Host ''
  Say '  Нужно связать компьютер с телевизором по коду (если переустанавливал adb или сбрасывал телевизор).' 'Yellow'
  Say '  В «Отладка по Wi-Fi» выбери «Подключить устройство с помощью кода».'
  Read-Host '  Когда окно с кодом откроется — нажми Enter' | Out-Null
  $pairSeen = Announced 'pairing'
  $pairPrompt = '  Адрес и порт из этого окна'
  if ($pairSeen) { $pairPrompt += " [Enter — $pairSeen]" }
  $pairAddr = (Read-Host $pairPrompt).Trim() -replace '\s', ''
  if (-not $pairAddr) { $pairAddr = $pairSeen }
  $code = (Read-Host '  Код').Trim() -replace '\s', ''
  if ($pairAddr -and $code) {
    $pr = A pair $pairAddr $code
    Say "  $pr"
    if ($pr -notmatch 'Successfully') { Fail 'Связать не получилось: проверь адрес и код.' }
    Start-Sleep -Seconds 2
    $again = Announced 'connect'
    if ($again) { $target = $again }
    $ok = TryConnect 10
  }
}
if (-not $ok -and $seen -and $seen -ne $target) {
  $target = $seen
  $ok = TryConnect 4
}
if (-not $ok) { Fail 'Приставка не ответила. Проверь «Отладка по Wi-Fi», адрес с портом, одну сеть и выключенный VPN.' }
function Shell([string]$cmd) { A -s $target shell $cmd }
$model = Shell 'getprop ro.product.model'
Say "  Подключено: $model" 'Green'

function FreeMb {
  $m = [regex]::Match((Shell 'cat /proc/meminfo'), 'MemAvailable:\s+(\d+)')
  if ($m.Success) { return [int]([long]$m.Groups[1].Value / 1024) }
  return 0
}
$before = FreeMb

# ---------- report first: what the box is and what eats it ----------
Step '2. Отчёт о приставке'
$desk = [Environment]::GetFolderPath('Desktop')
if (-not $desk -or -not (Test-Path $desk)) { $desk = $env:USERPROFILE }
$report = Join-Path $desk 'Rezonans-TV-report.txt'
$parts = [ordered]@{
  'Модель и прошивка' = "getprop | grep -E 'ro.product.(model|brand|manufacturer|device|cpu.abilist)|ro.build.(version.release|version.sdk|display.id|fingerprint)|ro.config.low_ram|dalvik.vm.heapsize|ro.hardware'"
  'Память' = 'head -n 6 /proc/meminfo'
  'Место' = 'df -h /data 2>/dev/null || df /data'
  'Экран' = 'wm size; wm density'
  'Анимации' = 'settings get global window_animation_scale; settings get global transition_animation_scale; settings get global animator_duration_scale'
  'Кто занимает память' = "dumpsys meminfo | sed -n '/Total PSS by process/,/Total PSS by OOM/p' | head -n 45"
  'Процессор сейчас' = 'top -b -n 1 -m 20 2>/dev/null || top -n 1 -m 20'
  'Домашний экран' = 'cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME'
  'Отключённые приложения' = 'pm list packages -d'
  'Установленные (не системные)' = 'pm list packages -3'
  'Системные' = 'pm list packages -s'
}
$sb = New-Object Text.StringBuilder
[void]$sb.AppendLine("Резонанс OS — отчёт о приставке, $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
foreach ($k in $parts.Keys) {
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine("===== $k =====")
  [void]$sb.AppendLine((Shell $parts[$k]))
}
[IO.File]::WriteAllText($report, $sb.ToString(), (New-Object Text.UTF8Encoding($false)))
Say "  Сохранён: $report" 'Green'

# ---------- the safe speed-ups ----------
Step '3. Ускорение'
foreach ($s in 'window_animation_scale', 'transition_animation_scale', 'animator_duration_scale') {
  Shell "settings put global $s 0.5" | Out-Null
}
Say '  Анимации системы вдвое быстрее (×0,5) — меню и переходы отзываются живее.'

Shell 'am kill-all' | Out-Null
Say '  Закрыты приложения, висевшие в фоне.'

$r = Shell 'pm trim-caches 999G'
Say '  Очищен кэш приложений (сами приложения и их данные не тронуты).'

Say '  Оптимизирую приложения под процессор приставки — может занять несколько минут, телевизор не выключай…'
$r = Shell 'cmd package bg-dexopt-job'
if ($r -match 'Unknown|Error|not found|Failure') { Say "  Приставка этого не умеет ($r) — пропускаю." 'Yellow' } else { Say '  Готово: приложения будут запускаться быстрее.' }

Shell 'am kill-all' | Out-Null
$after = FreeMb
Write-Host ''
if ($before -and $after) { Say "  Свободная память: было $before МБ, стало $after МБ." 'Green' }
Write-Host '  Готово!' -ForegroundColor Green
Say '  Анимации вернуть: Настройки → «Для разработчиков» → «Анимация окон/переходов/длительность» → 1x.'
Say '  Хочешь ускорить сильнее — пришли Claude файл Rezonans-TV-report.txt с рабочего стола:'
Say '  по нему видно, какие приложения Сбера крутятся зря, и их можно выключить (это тоже обратимо).'
