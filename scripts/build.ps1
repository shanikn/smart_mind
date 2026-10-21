# Start an EAS phone build from C:\fc\app\mobile.
# Usage:  .\scripts\build.ps1 apk      (Android APK to install on the S8, current branch)
#         .\scripts\build.ps1 android  (Android app bundle for Google Play, from main)
#         .\scripts\build.ps1 ios      (iOS build + auto-submit to TestFlight, from main)

param(
    [Parameter(Mandatory = $true)][ValidateSet("apk", "android", "ios")][string]$Target
)

$ErrorActionPreference = "Stop"
$Repo = "C:\fc\app"

function Run([string]$Label, [scriptblock]$Cmd) {
    Write-Host "`n=== $Label ===" -ForegroundColor Cyan
    & $Cmd
    if ($LASTEXITCODE -ne 0) { throw "Step failed: $Label (exit code $LASTEXITCODE)" }
}

Set-Location $Repo

try {
    if ($Target -ne "apk") {
        Run "Switch to main" { git checkout main }
    }
    $branch = git branch --show-current
    Write-Host "Building from branch: $branch"

    $lockBefore = (Get-FileHash "mobile\package-lock.json").Hash
    Run "Pull $branch" { git pull }
    $lockAfter = (Get-FileHash "mobile\package-lock.json").Hash

    Set-Location "$Repo\mobile"
    if ($lockBefore -ne $lockAfter -or -not (Test-Path "node_modules")) {
        Run "npm install (packages changed)" { npm install }
    }

    switch ($Target) {
        "apk"     { Run "EAS build: Android APK" { eas build --platform android --profile preview } }
        "android" { Run "EAS build: Android for Play" { eas build --platform android --profile production } }
        "ios"     { Run "EAS build: iOS + TestFlight" { eas build --platform ios --profile production --auto-submit } }
    }

    Write-Host "`nDone." -ForegroundColor Green
}
finally {
    # back to dev even when a step failed
    if ($Target -ne "apk") {
        Set-Location $Repo
        Write-Host "`n=== Back to dev ===" -ForegroundColor Cyan
        git checkout dev
        if ($LASTEXITCODE -ne 0) { Write-Warning "Couldn't switch back to dev; run: git checkout dev" }
    }
}
