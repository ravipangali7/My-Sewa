# Build a production MySewa APK that can update over BOTH:
# - release-signed installs (mysewa-release-key.jks)
# - older debug-signed installs (via APK Signature Scheme v3 lineage)
#
# Usage (from repo):
#   powershell -ExecutionPolicy Bypass -File app/tool/build_release_apk.ps1

$ErrorActionPreference = "Stop"
$appDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $appDir

Write-Host "Building release APK..."
flutter build apk --release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Ensuring lineage resign on Flutter output..."
Set-Location (Join-Path $appDir "android")
.\gradlew.bat :app:resignReleaseWithLineage
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$apk = Join-Path $appDir "build\app\outputs\flutter-apk\app-release.apk"
Write-Host ""
Write-Host "Release APK ready:"
Write-Host "  $apk"
Write-Host "Upload this file in Admin → App update with version matching pubspec (e.g. 4.0.0)."
