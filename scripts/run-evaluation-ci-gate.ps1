param()

$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptRoot '..')
$pythonRuntimeRoot = Join-Path (Split-Path -Parent $projectRoot) 'my-first-agent-langgraph'
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$logRoot = Join-Path $projectRoot ".tmp\evaluation-ci-gate\$runId"
$summaryPath = Join-Path $projectRoot 'evaluation-ci-gate-summary.json'

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

function Invoke-EvaluationStep {
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
    $process.StartInfo.FileName = $Command
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

$results += Invoke-EvaluationStep `
  -Name 'eval-dataset-schema' `
  -WorkingDirectory $pythonRuntimeRoot `
  -Command $pythonCommand `
  -Arguments @('-m', 'pytest', 'tests\evals\test_eval_dataset_schema.py')

$results += Invoke-EvaluationStep `
  -Name 'deepeval-gate' `
  -WorkingDirectory $pythonRuntimeRoot `
  -Command $pythonCommand `
  -Arguments @(
    '-m', 'pytest',
    'tests\evals\test_eval_judge_config.py',
    'tests\evals\test_deepeval_gate.py'
  )

$results += Invoke-EvaluationStep `
  -Name 'ragas-gate' `
  -WorkingDirectory $pythonRuntimeRoot `
  -Command $pythonCommand `
  -Arguments @(
    '-m', 'pytest',
    'tests\evals\test_ragas_mapping.py',
    'tests\evals\test_rag_metrics.py'
  )

$results += Invoke-EvaluationStep `
  -Name 'eval-ruff' `
  -WorkingDirectory $pythonRuntimeRoot `
  -Command $pythonCommand `
  -Arguments @('-m', 'ruff', 'check', 'tests\evals')

$summary = [PSCustomObject]@{
  runId = $runId
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  status = if (@($results | Where-Object { $_.status -eq 'failed' }).Count -gt 0) { 'failed' } else { 'passed' }
  logRoot = $logRoot
  results = $results
}

$summary | ConvertTo-Json -Depth 6 | Set-Content -Path $summaryPath -Encoding UTF8
Write-Host "Evaluation CI gate summary written to $summaryPath" -ForegroundColor Cyan

if ($summary.status -eq 'failed') {
  exit 1
}
