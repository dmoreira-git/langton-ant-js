#requires -Version 5.1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSCommandPath
Set-Location $root

function Find-Node {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidates = @(
    'C:\Program Files\nodejs\node.exe',
    'C:\Program Files (x86)\nodejs\node.exe'
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { return $candidate }
  }

  # Optional fallback for DeepSeek Harness sessions, where Node is provided by the app.
  if ($env:DSH_NODE_EXECUTABLE -and (Test-Path $env:DSH_NODE_EXECUTABLE)) {
    $env:ELECTRON_RUN_AS_NODE = '1'
    return $env:DSH_NODE_EXECUTABLE
  }

  throw 'Node.js was not found. Install Node.js 20.19+ from https://nodejs.org and run this again.'
}

$node = Find-Node
$vite = Join-Path $root 'node_modules\vite\bin\vite.js'

if (-not (Test-Path $vite)) {
  throw 'Dependencies are missing. Run npm install first.'
}

Write-Host ''
Write-Host '  LANGTON ANT LAB' -ForegroundColor Cyan
Write-Host '  http://localhost:5173/' -ForegroundColor Green
Write-Host ''

& $node $vite --host 127.0.0.1 --port 5173
exit $LASTEXITCODE
