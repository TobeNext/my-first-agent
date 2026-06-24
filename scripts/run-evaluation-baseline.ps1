param(
  [switch]$SkipWorkspaceTests,
  [switch]$SkipPythonTests,
  [switch]$SkipPythonSmoke,
  [switch]$SkipRollbackSmoke
)

$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptRoot '..')
$pythonRuntimeRoot = Join-Path (Split-Path -Parent $projectRoot) 'my-first-agent-langgraph'
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$logRoot = Join-Path $projectRoot ".tmp\evaluation-baseline\$runId"
$summaryPath = Join-Path $projectRoot 'evaluation-baseline-summary.json'

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

function Resolve-PythonCommand {
  $venvPython = Join-Path $pythonRuntimeRoot '.venv\Scripts\python.exe'
  if (Test-Path -LiteralPath $venvPython) {
    return $venvPython
  }

  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return $python.Source
  }

  throw 'Python executable not found. Expected ../my-first-agent-langgraph/.venv or python on PATH.'
}

function Test-DockerAvailable {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    return $false
  }

  & docker info *> $null
  return ($LASTEXITCODE -eq 0)
}

function New-SkippedStep {
  param(
    [string]$Name,
    [string]$Reason
  )

  return [PSCustomObject]@{
    name = $Name
    status = 'skipped'
    durationSeconds = 0
    logPath = $null
    skippedReason = $Reason
  }
}

function ConvertTo-ProcessArgumentString {
  param([string[]]$Arguments)

  return ($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') {
      '"' + ($_ -replace '"', '\"') + '"'
    } else {
      $_
    }
  }) -join ' '
}

function Resolve-ProcessCommand {
  param([string]$Command)

  if ($Command -match '[\\/]') {
    return $Command
  }

  $cmdExecutable = Get-Command "$Command.cmd" -ErrorAction SilentlyContinue
  if ($cmdExecutable) {
    return $cmdExecutable.Source
  }

  $executable = Get-Command $Command -ErrorAction SilentlyContinue
  if ($executable) {
    return $executable.Source
  }

  return $Command
}

function Invoke-BaselineStep {
  param(
    [string]$Name,
    [string]$WorkingDirectory,
    [string]$Command,
    [string[]]$Arguments
  )

  $safeName = ($Name -replace '[^A-Za-z0-9_.-]', '-').ToLowerInvariant()
  $logPath = Join-Path $logRoot "$safeName.log"
  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

  Write-Host "[$Name] starting..." -ForegroundColor Cyan
  $output = New-Object System.Collections.Generic.List[string]
  try {
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo.FileName = Resolve-ProcessCommand -Command $Command
    $process.StartInfo.WorkingDirectory = $WorkingDirectory
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    $process.StartInfo.Arguments = ConvertTo-ProcessArgumentString -Arguments $Arguments

    [void]$process.Start()
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    $exitCode = $process.ExitCode

    if ($stdout) {
      $stdout -split "(`r`n|`n|`r)" |
        Where-Object { $_ -ne '' } |
        ForEach-Object { $output.Add($_); Write-Host $_ }
    }
    if ($stderr) {
      $stderr -split "(`r`n|`n|`r)" |
        Where-Object { $_ -ne '' } |
        ForEach-Object { $output.Add($_); Write-Host $_ }
    }
    $output | Set-Content -Path $logPath -Encoding UTF8
  } catch {
    $_ |
      Out-String |
      Tee-Object -FilePath $logPath -Append |
      ForEach-Object { Write-Host $_ }
    $exitCode = 1
  } finally {
    $stopwatch.Stop()
  }

  $status = if ($exitCode -eq 0) { 'passed' } else { 'failed' }
  $color = if ($status -eq 'passed') { 'Green' } else { 'Red' }
  Write-Host "[$Name] $status in $([Math]::Round($stopwatch.Elapsed.TotalSeconds, 2))s" -ForegroundColor $color

  return [PSCustomObject]@{
    name = $Name
    status = $status
    durationSeconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
    logPath = $logPath
    skippedReason = $null
  }
}

$results = @()
$pythonCommand = Resolve-PythonCommand

if ($SkipWorkspaceTests) {
  $results += New-SkippedStep -Name 'workspace-tests' -Reason 'Skipped by -SkipWorkspaceTests.'
} else {
  $results += Invoke-BaselineStep `
    -Name 'workspace-tests' `
    -WorkingDirectory $projectRoot `
    -Command 'npm' `
    -Arguments @('run', 'test:workspace')
}

if ($SkipPythonTests) {
  $results += New-SkippedStep -Name 'python-pytest' -Reason 'Skipped by -SkipPythonTests.'
} else {
  $results += Invoke-BaselineStep `
    -Name 'python-pytest' `
    -WorkingDirectory $pythonRuntimeRoot `
    -Command $pythonCommand `
    -Arguments @('-m', 'pytest', 'tests')
}

if ($SkipPythonSmoke) {
  $results += New-SkippedStep -Name 'python-e2e-smoke' -Reason 'Skipped by -SkipPythonSmoke.'
} else {
  $results += Invoke-BaselineStep `
    -Name 'python-e2e-smoke' `
    -WorkingDirectory $projectRoot `
    -Command 'npm' `
    -Arguments @('run', 'test:e2e:interview:smoke:python')
}

if ($SkipRollbackSmoke) {
  $results += New-SkippedStep -Name 'rollback-smoke' -Reason 'Skipped by -SkipRollbackSmoke.'
} elseif (-not (Test-DockerAvailable)) {
  $results += New-SkippedStep -Name 'rollback-smoke' -Reason 'Docker is unavailable.'
} else {
  $results += Invoke-BaselineStep `
    -Name 'rollback-smoke' `
    -WorkingDirectory $projectRoot `
    -Command 'npm' `
    -Arguments @('run', 'test:e2e:interview:rollback-smoke')
}

$summary = [PSCustomObject]@{
  runId = $runId
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  status = if (@($results | Where-Object { $_.status -eq 'failed' }).Count -gt 0) { 'failed' } else { 'passed' }
  logRoot = $logRoot
  results = $results
}

$summary | ConvertTo-Json -Depth 6 | Set-Content -Path $summaryPath -Encoding UTF8
Write-Host "Evaluation baseline summary written to $summaryPath" -ForegroundColor Cyan

if ($summary.status -eq 'failed') {
  exit 1
}
