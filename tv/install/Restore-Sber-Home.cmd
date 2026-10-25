@echo off
rem Puts the TV box's own home screen back (removes Rezonans OS). Everything
rem below the PSSTART line is PowerShell.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText('%~f0',[Text.Encoding]::UTF8); $i=$s.IndexOf('#'+'PSSTART'); Invoke-Expression $s.Substring($i)"
echo.
pause
exit /b
#PSSTART
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$work = Join-Path $env:LOCALAPPDATA 'RezonansOS'
$adb = Join-Path $work 'platform-tools\adb.exe'
$pkg = 'app.rezonans.tv'
if (-not (Test-Path $adb)) { Write-Host '  Сначала нужен adb: запусти Install-Rezonans-OS.cmd хотя бы раз.' -ForegroundColor Red; exit 1 }
$ipFile = Join-Path $work 'tv-ip.txt'
$last = if (Test-Path $ipFile) { (Get-Content $ipFile -Raw).Trim() } else { '' }
$ip = (Read-Host "  адрес приставки [Enter — $last]").Trim()
if (-not $ip) { $ip = $last }
$target = if ($ip -match ':\d+$') { $ip } else { "${ip}:5555" }
& $adb connect $target | Out-Null
$state = (& $adb -s $target get-state 2>&1 | Out-String).Trim()
if ($state -ne 'device') { Write-Host "  Приставка не отвечает ($state)." -ForegroundColor Red; exit 1 }
$svc = "$pkg/$pkg.HomeGuard"
$cur = (& $adb -s $target shell settings get secure enabled_accessibility_services | Out-String).Trim()
$rest = ($cur -split ':' | Where-Object { $_ -and $_ -ne $svc -and $_ -ne 'null' }) -join ':'
if ($rest) { & $adb -s $target shell settings put secure enabled_accessibility_services $rest | Out-Null }
else { & $adb -s $target shell settings delete secure enabled_accessibility_services | Out-Null }
$choice = Read-Host '  Удалить Резонанс OS совсем? (д/н)'
if ($choice -match '^[дДyY]') {
  & $adb -s $target uninstall $pkg | Out-Null
  Write-Host '  Резонанс OS удалён, экран Сбера вернулся.' -ForegroundColor Green
} else {
  # the box's own home screen becomes the Home button's again
  $homes = (& $adb -s $target shell 'cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME' | Out-String) -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '/' -and $_ -notlike "$pkg/*" -and $_ -notmatch 'FallbackHome' }
  if ($homes) { & $adb -s $target shell "cmd package set-home-activity $($homes[0])" | Out-Null }
  & $adb -s $target shell input keyevent KEYCODE_HOME | Out-Null
  Write-Host '  Кнопка «Домой» снова ведёт на экран Сбера. Резонанс OS остался в списке приложений.' -ForegroundColor Green
}
