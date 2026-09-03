# Low-memory release build for machines with ~8 GB RAM.
# Stops old Gradle daemons, builds, then re-applies signing lineage.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File app/tool/build_release_apk.ps1

$ErrorActionPreference = "Stop"
$appDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $appDir

Write-Host "Stopping old Gradle daemons to free RAM..."
Push-Location (Join-Path $appDir "android")
try {
    .\gradlew.bat --stop 2>$null
} catch {
    # ignore
}
Pop-Location

# Hint Kotlin/Gradle child processes to stay small even if IDE overrides props.
$env:GRADLE_OPTS = "-Xmx1024m -Dorg.gradle.daemon=true"
$env:JAVA_TOOL_OPTIONS = ""

Write-Host "Building release APK (low memory settings)..."
flutter build apk --release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Ensuring lineage resign on Flutter output..."
Set-Location (Join-Path $appDir "android")
.\gradlew.bat :app:resignReleaseWithLineage --no-daemon
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$apk = Join-Path $appDir "build\app\outputs\flutter-apk\app-release.apk"
Write-Host ""
Write-Host "Release APK ready:"
Write-Host "  $apk"
Write-Host "Upload this file in Admin → App update with the matching version (e.g. 4.0.0)."
