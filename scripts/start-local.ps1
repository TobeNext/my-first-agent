param(
  [switch]$StartDockerDependencies
)

$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptRoot '..')

function Ensure-PathExists {
  param(
    [string]$Path,
    [string]$Description
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Description not found: $Path"
  }
}

function Install-DependenciesIfNeeded {
  param(
    [string]$ServicePath,
    [string]$ServiceName
  )

  $nodeModulesPath = Join-Path $ServicePath 'node_modules'
  if (Test-Path -LiteralPath $nodeModulesPath) {
    return
  }

  Write-Host "[$ServiceName] node_modules missing, running npm install..." -ForegroundColor Yellow
  npm install --prefix $ServicePath
}

function Escape-SingleQuotedString {
  param([string]$Value)

  return $Value -replace "'", "''"
}

function Start-DockerDependencies {
  Write-Host '[Docker] starting dependency services (etcd, minio, milvus, redis)...' -ForegroundColor Cyan

  docker compose up -d etcd minio milvus redis

  Write-Host '[Docker] dependency services requested.' -ForegroundColor Green
}

function Wait-ForTcpPort {
  param(
    [string]$ServiceName,
    [int]$Port,
    [int]$TimeoutSeconds = 90
  )

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

  while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($connection) {
      Write-Host "[$ServiceName] port $Port is listening." -ForegroundColor Green
      return
    }

    Start-Sleep -Seconds 2
  }

  throw "Timed out waiting for $ServiceName on port $Port after $TimeoutSeconds seconds."
}

function Get-PortListenerInfos {
  param([int]$Port)

  try {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
  } catch {
    return @()
  }

  if ($null -eq $connections) {
    return @()
  }

  $listeners = @()

  foreach ($connection in ($connections | Sort-Object -Property OwningProcess -Unique)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue

    $listeners += [PSCustomObject]@{
      Port = $Port
      ProcessId = $connection.OwningProcess
      Name = $process.Name
      CommandLine = $process.CommandLine
    }
  }

  return $listeners
}

function Wait-ForPortToBeReleased {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 10
  )

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

  while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    if ((Get-PortListenerInfos -Port $Port).Count -eq 0) {
      return
    }

    Start-Sleep -Milliseconds 250
  }

  throw "Port $Port is still occupied after waiting $TimeoutSeconds seconds."
}

function Stop-PortListeners {
  param(
    [string]$ServiceName,
    [int]$Port
  )

  $listenerInfos = Get-PortListenerInfos -Port $Port
  if ($listenerInfos.Count -eq 0) {
    Write-Host "[$ServiceName] port $Port is free." -ForegroundColor DarkGray
    return $false
  }

  foreach ($listenerInfo in $listenerInfos) {
    $ownerName = if ([string]::IsNullOrWhiteSpace($listenerInfo.Name)) { 'unknown process' } else { $listenerInfo.Name }
    Write-Host "[$ServiceName] stopping PID $($listenerInfo.ProcessId) ($ownerName) on port $Port..." -ForegroundColor Yellow

    $process = Get-Process -Id $listenerInfo.ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $process) {
      Write-Host "[$ServiceName] PID $($listenerInfo.ProcessId) is no longer running; re-checking port $Port..." -ForegroundColor DarkYellow
      continue
    }

    try {
      Stop-Process -Id $listenerInfo.ProcessId -Force -ErrorAction Stop
    } catch {
      if ($_.FullyQualifiedErrorId -eq 'NoProcessFoundForGivenId,Microsoft.PowerShell.Commands.StopProcessCommand') {
        Write-Host "[$ServiceName] PID $($listenerInfo.ProcessId) exited before it could be stopped; re-checking port $Port..." -ForegroundColor DarkYellow
        continue
      }

      throw
    }
  }

  Wait-ForPortToBeReleased -Port $Port
  Write-Host "[$ServiceName] port $Port has been released." -ForegroundColor Green

  return $true
}

function Start-ServiceWindow {
  param(
    [string]$ServiceName,
    [string]$ServicePath,
    [string]$Command
  )

  $escapedPath = Escape-SingleQuotedString $ServicePath
  $windowCommand = "Set-Location '$escapedPath'; $Command"

  Start-Process -FilePath 'powershell.exe' -WorkingDirectory $ServicePath -ArgumentList @(
    '-NoExit',
    '-ExecutionPolicy', 'Bypass',
    '-Command', $windowCommand
  ) | Out-Null

  Write-Host "[$ServiceName] started in a new PowerShell window." -ForegroundColor Green
}

$envFilePath = Join-Path $projectRoot '.env'
Ensure-PathExists -Path $envFilePath -Description '.env file'

if ($StartDockerDependencies) {
  Start-DockerDependencies
  Wait-ForTcpPort -ServiceName 'Redis' -Port 6379 -TimeoutSeconds 60
  Wait-ForTcpPort -ServiceName 'Milvus' -Port 19530 -TimeoutSeconds 120
}

$services = @(
  @{
    Name = 'Mastra';
    Path = [string]$projectRoot;
    Command = 'npm run dev';
    Port = 4111;
    Url = 'http://localhost:4111';
  },
  @{
    Name = 'BFF';
    Path = Join-Path $projectRoot 'bff';
    Command = 'npm run start:dev';
    Port = 3000;
    Url = 'http://localhost:3000';
  },
  @{
    Name = 'Frontend';
    Path = Join-Path $projectRoot 'frontend';
    Command = 'npm run dev';
    Port = 4173;
    Url = 'http://localhost:4173';
  }
)

$serviceResults = @()

foreach ($service in $services) {
  Ensure-PathExists -Path $service.Path -Description "$($service.Name) directory"
  Install-DependenciesIfNeeded -ServicePath $service.Path -ServiceName $service.Name
}

foreach ($service in $services) {
  $reclaimedPort = Stop-PortListeners -ServiceName $service.Name -Port $service.Port
  Start-ServiceWindow -ServiceName $service.Name -ServicePath $service.Path -Command $service.Command

  if ($reclaimedPort) {
    $serviceResults += "- $($service.Name): restarted after terminating the previous listener ($($service.Url))"
  } else {
    $serviceResults += "- $($service.Name): started ($($service.Url))"
  }
}

Write-Host ''
Write-Host 'Local development service status:' -ForegroundColor Cyan
foreach ($serviceResult in $serviceResults) {
  Write-Host $serviceResult
}
Write-Host ''
Write-Host 'Any process that was occupying a required port was terminated before startup.' -ForegroundColor DarkYellow
