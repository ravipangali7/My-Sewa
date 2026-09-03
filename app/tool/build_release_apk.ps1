# Low-memory production APK build.
# 1) flutter build apk (Gradle alone — no apksigner peak)
# 2) resign with debug→release lineage after Gradle exits
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File app/tool/build_release_apk.ps1

$ErrorActionPreference = "Stop"
$appDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $appDir

Write-Host "Stopping old Gradle daemons to free RAM..."
Push-Location (Join-Path $appDir "android")
try { .\gradlew.bat --stop 2>$null } catch {}
Pop-Location

Write-Host "Building release APK..."
flutter build apk --release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Stopping Gradle again before lineage resign..."
Push-Location (Join-Path $appDir "android")
try { .\gradlew.bat --stop 2>$null } catch {}
Start-Sleep -Seconds 2

Write-Host "Applying debug→release signing lineage..."
.\gradlew.bat :app:resignReleaseWithLineage --no-daemon
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Pop-Location

$apk = Join-Path $appDir "build\app\outputs\flutter-apk\app-release.apk"
$item = Get-Item $apk
Write-Host ""
Write-Host "Release APK ready:"
Write-Host ("  {0} ({1:N1} MB)" -f $item.FullName, ($item.Length / 1MB))
Write-Host "Upload in Admin → App update with the matching version from pubspec.yaml."
