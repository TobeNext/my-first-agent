param(
  [switch]$KeepStack
)

$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptRoot '..')

function Wait-ForHttpTarget {
  param(
    [string]$Name,
    [string]$Url,
    [int]$TimeoutSeconds = 180
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 10 -UseBasicParsing
      if ($response.StatusCode -lt 500) {
        Write-Host "[$Name] ready at $Url" -ForegroundColor Green
        return
      }
    } catch {
      Start-Sleep -Seconds 5
      continue
    }

    Start-Sleep -Seconds 5
  }

  throw "Timed out waiting for $Name at $Url."
}

function Start-StackForProvider {
  param([ValidateSet('python', 'mastra')] [string]$Provider)

  Write-Host "[Rollback smoke] Starting stack with AGENT_RUNTIME_PROVIDER=$Provider..." -ForegroundColor Cyan
  $env:AGENT_RUNTIME_PROVIDER = $Provider
  docker compose up -d --build

  Wait-ForHttpTarget -Name 'frontend' -Url 'http://localhost:8080'
  Wait-ForHttpTarget -Name 'bff' -Url 'http://localhost:3000'

  if ($Provider -eq 'python') {
    Wait-ForHttpTarget -Name 'python-agent' -Url 'http://localhost:8011/health'
  } else {
    Wait-ForHttpTarget -Name 'mastra' -Url 'http://localhost:4111/api'
  }
}

function Stop-Stack {
  Write-Host '[Rollback smoke] Stopping stack...' -ForegroundColor Cyan
  docker compose down --volumes
}

try {
  Set-Location $projectRoot

  Start-StackForProvider -Provider 'python'
  npm run test:e2e:interview:smoke:python
  Stop-Stack

  Start-StackForProvider -Provider 'mastra'
  npm run test:e2e:interview:smoke:mastra
} finally {
  if (-not $KeepStack) {
    Stop-Stack
  }
}
