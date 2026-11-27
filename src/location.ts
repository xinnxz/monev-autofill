import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Coords { latitude: number; longitude: number; accuracy: number }

/**
 * Lokasi asli perangkat dari Windows Location Service (Wi-Fi/GPS).
 * Butuh: Settings → Privacy & security → Location → aktif, termasuk "Let desktop apps access your location".
 */
export async function windowsLocation(timeoutSec = 20): Promise<Coords | null> {
  const ps = `
Add-Type -AssemblyName System.Device
$w = New-Object System.Device.Location.GeoCoordinateWatcher([System.Device.Location.GeoPositionAccuracy]::High)
$null = $w.TryStart($false, [TimeSpan]::FromSeconds(${timeoutSec}))
$deadline = (Get-Date).AddSeconds(${timeoutSec})
while ($w.Status -ne 'Ready' -and $w.Permission -ne 'Denied' -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
$c = $w.Position.Location
if ($w.Permission -eq 'Denied') { '{"error":"denied"}' }
elseif ($c.IsUnknown) { '{"error":"unknown"}' }
else { $ic = [Globalization.CultureInfo]::InvariantCulture; '{"latitude":' + $c.Latitude.ToString($ic) + ',"longitude":' + $c.Longitude.ToString($ic) + ',"accuracy":' + [math]::Round($c.HorizontalAccuracy).ToString($ic) + '}' }
$w.Stop()`;
  try {
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      encoding: "utf8", timeout: (timeoutSec + 15) * 1000,
    });
    const out = stdout.trim().split("\n").pop()!;
    const json = JSON.parse(out);
    return json.error ? null : json;
  } catch {
    return null;
  }
}
