# Deploy the backend to Azure as a new Docker image version.
# Usage (from anywhere):  .\scripts\deploy.ps1 16
# Runs in C:\fc\app: main -> pull -> docker build/push -> Azure update -> restart -> back to dev.

param(
    [Parameter(Mandatory = $true)][int]$Version
)

$ErrorActionPreference = "Stop"
$Repo = "C:\fc\app"
$Image = "shaniki/contextmind:v$Version"
$App = "contextmind-api"
$Group = "contextmind-rg"

function Run([string]$Label, [scriptblock]$Cmd) {
    Write-Host "`n=== $Label ===" -ForegroundColor Cyan
    & $Cmd
    if ($LASTEXITCODE -ne 0) { throw "Step failed: $Label (exit code $LASTEXITCODE)" }
}

Set-Location $Repo

$current = az webapp sitecontainers list -n $App -g $Group --query "[].image" -o tsv
if ($LASTEXITCODE -ne 0 -or -not $current) { throw "Couldn't read the live image from Azure (signed in? try: az login)." }
Write-Host "Live image now: $current"
if ($current -match "contextmind:v$Version$") { throw "v$Version is already live. Use the next number." }
# never overwrite an older version: it's the rollback target
docker manifest inspect $Image *> $null
if ($LASTEXITCODE -eq 0) { throw "$Image already exists on Docker Hub. Use the next number." }
$answer = Read-Host "Deploy $Image ? (y/n)"
if ($answer -ne "y") { Write-Host "Cancelled."; exit 0 }

try {
    Run "Switch to main" { git checkout main }
    $before = git rev-parse HEAD
    Run "Pull main" { git pull }
    if ((git rev-parse HEAD) -eq $before) {
        $answer = Read-Host "git pull brought no changes. Deploy anyway? (y/n)"
        if ($answer -ne "y") { Write-Host "Cancelled."; exit 0 }
    }

    # the image is built from this folder, so it must match the pulled commit
    $dirty = git status --porcelain
    if ($dirty) { throw "C:\fc\app has uncommitted or untracked files; commit, stash or delete them first:`n$dirty" }

    Run "Docker build $Image" { docker build -t $Image . }

    # Docker Hub sometimes answers 502; retry a few times.
    $pushed = $false
    for ($i = 1; $i -le 3 -and -not $pushed; $i++) {
        Write-Host "`n=== Docker push (try $i) ===" -ForegroundColor Cyan
        docker push $Image
        if ($LASTEXITCODE -eq 0) { $pushed = $true } else { Start-Sleep -Seconds 5 }
    }
    if (-not $pushed) { throw "Docker push failed 3 times." }

    Run "Point Azure at $Image" {
        az webapp sitecontainers update -n $App -g $Group --container-name main --image "index.docker.io/$Image"
    }
    Run "Restart Azure app" { az webapp restart -n $App -g $Group }

    $now = az webapp sitecontainers list -n $App -g $Group --query "[].image" -o tsv
    if ($LASTEXITCODE -ne 0 -or $now -notmatch "contextmind:v$Version$") { throw "Azure doesn't show $Image as live (it shows: $now)." }
    Write-Host "`nDone. Live image: $now" -ForegroundColor Green
}
finally {
    Write-Host "`n=== Back to dev ===" -ForegroundColor Cyan
    git checkout dev
    if ($LASTEXITCODE -ne 0) { Write-Warning "Couldn't switch back to dev; run: git checkout dev" }
}
