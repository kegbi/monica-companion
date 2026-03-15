param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$ShortName
)

$ErrorActionPreference = "Stop"

$BaseDir = "context/spec"

if (-not (Test-Path $BaseDir)) {
    New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null
}

$maxIndex = -1

Get-ChildItem -Path $BaseDir -Directory | ForEach-Object {
    if ($_.Name -match '^(\d{3})-') {
        $idx = [int]$Matches[1]
        if ($idx -gt $maxIndex) {
            $maxIndex = $idx
        }
    }
}

if ($maxIndex -lt 0) {
    $next = 1
} else {
    $next = $maxIndex + 1
}

if ($next -gt 999) {
    Write-Error "Error: next index would exceed 999."
    exit 1
}

$nextIndex = "{0:D3}" -f $next
$newDir = "$BaseDir/$nextIndex-$ShortName"

New-Item -ItemType Directory -Path $newDir -Force | Out-Null

Write-Output "Created: $newDir"
