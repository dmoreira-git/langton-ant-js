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
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
$localPnpm = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'

Write-Host 'Installing Langton Ant Lab dependencies...' -ForegroundColor Cyan

if ($pnpmCommand) {
  & $pnpmCommand.Source install --config.node-linker=hoisted
} elseif (Test-Path $localPnpm) {
  & $node $localPnpm install --config.node-linker=hoisted
} else {
  throw 'pnpm was not found. Install it with: corepack enable'
}

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ''
Write-Host 'Done. Start the lab with .\run.cmd' -ForegroundColor Green
