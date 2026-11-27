# Daftarkan dua jadwal harian (Senin-Jumat) di Windows Task Scheduler:
#   MonevAsk      21.00  bot Telegram bertanya "hari ini ngapain aja?"
#   MonevAutofill 23.00  susun isi + buka form di Chrome + notifikasi
# Jalankan sekali dari folder project:
#   powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1
param(
  [string]$AskTime = "21:00",
  [string]$FillTime = "23:00"
)

$ProjectDir = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force (Join-Path $ProjectDir "logs") | Out-Null

# Jalan hanya saat kamu login (jendela Chrome harus terlihat), bangunkan laptop dari sleep,
# dan JANGAN mengejar jadwal yang terlewat (bisa salah tanggal).
$settings = New-ScheduledTaskSettingsSet `
  -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive
$days = "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"

function Register-MonevTask($Name, $Time, $NpmArgs) {
  $action = New-ScheduledTaskAction -Execute "cmd.exe" `
    -Argument "/c npm $NpmArgs >> logs\run.log 2>&1" -WorkingDirectory $ProjectDir
  $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $days -At $Time
  Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger `
    -Settings $settings -Principal $principal -Force | Out-Null
  Write-Host "Terjadwal: $Name  Senin-Jumat $Time  (npm $NpmArgs)"
}

if ($AskTime) { Register-MonevTask "MonevAsk" $AskTime "run ask" } else { Unregister-ScheduledTask -TaskName MonevAsk -Confirm:$false -ErrorAction SilentlyContinue; Write-Host "MonevAsk tidak dipasang (tanpa pertanyaan Telegram)" }
Register-MonevTask "MonevAutofill" $FillTime "start"

Write-Host "Folder: $ProjectDir"
Write-Host "Hapus jadwal:  Unregister-ScheduledTask -TaskName MonevAsk,MonevAutofill -Confirm:`$false"
