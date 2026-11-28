# Jadwal "otomatis saat laptop aktif" (tanpa jam tetap).
# Tugas MonevAuto dipicu saat: login, laptop dibuka kuncinya, Wi-Fi/jaringan tersambung,
# dan tiap 30 menit pukul 15.00-24.00. Programnya sendiri yang memutuskan perlu jalan atau tidak:
# hanya hari kerja, hanya mulai jam AUTO_START_HOUR (default 15), hanya kalau ada internet,
# dan form dibuka sekali sehari (dibuka lagi 2 jam kemudian kalau belum dikirim).
#
#   powershell -ExecutionPolicy Bypass -File scripts\register-auto.ps1
#   Hapus: Unregister-ScheduledTask -TaskName MonevAuto -Confirm:$false

$TaskName = "MonevAuto"
$ProjectDir = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force (Join-Path $ProjectDir "logs") | Out-Null

# Peluncur tersembunyi: cek diam-diam dulu, jendela konfirmasi hanya muncul kalau memang perlu
# (hari kerja, sudah jam 15, ada internet, ada aktivitas, dan belum dikirim/dibatalkan hari itu).
$action = New-ScheduledTaskAction -Execute "wscript.exe" `
  -Argument "`"$ProjectDir\scripts\auto-launcher.vbs`"" -WorkingDirectory $ProjectDir

$user = "$env:USERDOMAIN\$env:USERNAME"
$triggers = @()

# 1. Saat login ke Windows.
$triggers += New-ScheduledTaskTrigger -AtLogOn -User $user

# 2. Saat laptop dibuka kuncinya (habis sleep / layar terkunci).
$stateClass = Get-CimClass -Namespace Root/Microsoft/Windows/TaskScheduler -ClassName MSFT_TaskSessionStateChangeTrigger
$unlock = New-CimInstance -CimClass $stateClass -ClientOnly
$unlock.StateChange = 8   # SessionUnlock
$unlock.UserId = $user
$unlock.Enabled = $true
$triggers += $unlock

# 3. Saat jaringan/Wi-Fi tersambung (NetworkProfile event 10000).
$eventClass = Get-CimClass -Namespace Root/Microsoft/Windows/TaskScheduler -ClassName MSFT_TaskEventTrigger
$net = New-CimInstance -CimClass $eventClass -ClientOnly
$net.Subscription = @"
<QueryList><Query Id="0" Path="Microsoft-Windows-NetworkProfile/Operational"><Select Path="Microsoft-Windows-NetworkProfile/Operational">*[System[(EventID=10000)]]</Select></Query></QueryList>
"@
$net.Delay = "PT1M"       # beri waktu 1 menit sampai internet benar-benar siap
$net.Enabled = $true
$triggers += $net

# 4. Tiap 30 menit dari 15.00 sampai 24.00 (cadangan kalau laptop menyala terus).
$daily = New-ScheduledTaskTrigger -Daily -At "15:00"
$repeat = New-ScheduledTaskTrigger -Once -At "15:00" -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Hours 9)
$daily.Repetition = $repeat.Repetition
$triggers += $daily

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
  -Settings $settings -Principal $principal -Force | Out-Null

# Jadwal jam tetap yang lama tidak diperlukan lagi.
Unregister-ScheduledTask -TaskName MonevAsk, MonevAutofill -Confirm:$false -ErrorAction SilentlyContinue

Write-Host "Terpasang: $TaskName (login, buka kunci, Wi-Fi tersambung, tiap 30 menit 15.00-24.00)"
Write-Host "Folder: $ProjectDir"
