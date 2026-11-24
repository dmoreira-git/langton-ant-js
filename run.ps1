#requires -Version 5.1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSCommandPath
Set-Location $root

function Find-Node {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @(
    (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'),
    'C:\Program Files\nodejs\node.exe',
    'C:\Program Files (x86)\nodejs\node.exe'
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }

  throw 'Node.js 20+ was not found. Install it from https://nodejs.org and run this again.'
}

$node = Find-Node
$vite = Join-Path $root 'node_modules\vite\bin\vite.js'

if (-not (Test-Path $vite)) {
  throw 'Dependencies are missing. Run .\install.cmd first.'
}

Write-Host ''
Write-Host '  LANGTON ANT LAB' -ForegroundColor Cyan
Write-Host '  http://127.0.0.1:5173/' -ForegroundColor Green
Write-Host ''

& $node $vite --host 127.0.0.1 --port 5173
exit $LASTEXITCODE
