# Pasang secrets & variables Mode HP ke repo GitHub dari .env dan konteks.md.
# Nilai rahasia dibaca dari file dan langsung dikirim ke GitHub, tidak ditampilkan.
#   powershell -ExecutionPolicy Bypass -File scripts\set-secrets.ps1 -Repo <user>/<repo> -ActivityToken <token GitHub kerja>
param(
  [Parameter(Mandatory)][string]$Repo,
  # Token GitHub akun kerja (classic, scope repo). Kosongkan untuk memakai token gh yang sedang login.
  [string]$ActivityToken = ""
)

$ProjectDir = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $ProjectDir ".env"
$vals = @{}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $vals[$Matches[1]] = $Matches[2].Trim() }
}

function Set-Secret($Name, $Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { Write-Host "  - $Name dilewati (kosong)"; return }
  $Value | gh secret set $Name -R $Repo --app actions
  Write-Host "  + secret $Name"
}
function Set-Var($Name, $Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { Write-Host "  - $Name dilewati (kosong)"; return }
  gh variable set $Name -R $Repo --body $Value | Out-Null
  Write-Host "  + variable $Name = $Value"
}

if (-not $ActivityToken) { $ActivityToken = $vals["GITHUB_TOKEN"] }
if (-not $ActivityToken) { $ActivityToken = (gh auth token) }

Write-Host "Secrets:"
Set-Secret "GEMINI_API_KEY" $vals["GEMINI_API_KEY"]
Set-Secret "TELEGRAM_BOT_TOKEN" $vals["TELEGRAM_BOT_TOKEN"]
Set-Secret "TELEGRAM_CHAT_ID" $vals["TELEGRAM_CHAT_ID"]
Set-Secret "ACTIVITY_GITHUB_TOKEN" $ActivityToken
Set-Secret "SLACK_USER_TOKEN" $vals["SLACK_USER_TOKEN"]
$ctx = Join-Path $ProjectDir "konteks.md"
if (Test-Path $ctx) { Set-Secret "PROJECT_CONTEXT" (Get-Content $ctx -Raw) }

Write-Host "Variables:"
Set-Var "MONEV_ENABLED" "true"
Set-Var "ACTIVITY_GITHUB_USER" $vals["GITHUB_USER"]
Set-Var "ROLE" $vals["ROLE"]
Set-Var "OFF_DAYS" $vals["OFF_DAYS"]
Set-Var "GEMINI_MODEL" $vals["GEMINI_MODEL"]
Set-Var "GEMINI_FALLBACK_MODEL" $vals["GEMINI_FALLBACK_MODEL"]
Set-Var "SLACK_USER_ID" $vals["SLACK_USER_ID"]

Write-Host "Selesai. Tes: gh workflow run monev-phone -R $Repo"
