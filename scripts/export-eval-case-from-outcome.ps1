param(
  [string]$ThreadId,
  [string]$ArtifactPath,
  [string]$OutputRoot = ".tmp\eval-case-drafts"
)

$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptRoot '..')
$outcomeRoot = Join-Path $projectRoot 'Interview outcome'
$outputRootPath = Join-Path $projectRoot $OutputRoot

function Get-Sha256Hex {
  param([string]$Value)

  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    return ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join ''
  } finally {
    $sha.Dispose()
  }
}

function Redact-Text {
  param([AllowNull()][string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }

  $result = $Value
  $result = [regex]::Replace($result, '\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b', '[REDACTED_EMAIL]')
  $result = [regex]::Replace($result, '(?<!\d)(?:\+?\d[\d .-]{8,}\d)(?!\d)', '[REDACTED_PHONE]')
  $result = [regex]::Replace($result, '\b\d{15,18}\b', '[REDACTED_ID]')
  $result = [regex]::Replace($result, '(?i)(姓名|name)\s*[:：]\s*\S+', '$1: [REDACTED_NAME]')
  $result = [regex]::Replace($result, '(?i)(公司|company)\s*[:：]\s*\S+', '$1: [REDACTED_COMPANY]')
  return $result
}

function Find-OutcomeArtifact {
  if ($ArtifactPath) {
    $resolved = Resolve-Path -LiteralPath $ArtifactPath
    return [string]$resolved
  }

  if (-not $ThreadId) {
    throw 'Provide either -ThreadId or -ArtifactPath.'
  }

  $matches = Get-ChildItem -Path $outcomeRoot -Recurse -File -Filter '*.json' -ErrorAction SilentlyContinue |
    Where-Object {
      $_.FullName -like "*$ThreadId*" -or (Get-Content -Raw -LiteralPath $_.FullName) -like "*$ThreadId*"
    } |
    Sort-Object LastWriteTime -Descending

  if (-not $matches -or $matches.Count -eq 0) {
    throw "No outcome artifact found for thread id: $ThreadId"
  }

  return [string]$matches[0].FullName
}

function Get-PropertyValue {
  param(
    [object]$Object,
    [string[]]$Names
  )

  foreach ($name in $Names) {
    if ($null -eq $Object) {
      continue
    }
    $property = $Object.PSObject.Properties[$name]
    if ($property) {
      return $property.Value
    }
  }
  return $null
}

$artifact = Find-OutcomeArtifact
$raw = Get-Content -Raw -LiteralPath $artifact
$parseError = $null
try {
  $payload = $raw | ConvertFrom-Json
} catch {
  $parseError = ($_.Exception.Message -split "(`r`n|`n|`r)")[0]
  $threadMatch = [regex]::Match($raw, '"threadId"\s*:\s*"([^"]+)"')
  $fallbackThreadId = if ($threadMatch.Success) { $threadMatch.Groups[1].Value } else { '' }
  $payload = [PSCustomObject]@{
    threadId = $fallbackThreadId
    session = [PSCustomObject]@{}
  }
}
$resolvedThreadId = [string](Get-PropertyValue -Object $payload -Names @('threadId', 'thread_id'))
if ([string]::IsNullOrWhiteSpace($resolvedThreadId)) {
  $resolvedThreadId = if ($ThreadId) { $ThreadId } else { [IO.Path]::GetFileName((Split-Path -Parent $artifact)) }
}

$session = Get-PropertyValue -Object $payload -Names @('session', 'interviewSnapshot')
$resumeContext = Get-PropertyValue -Object $session -Names @('resumeContext')
$setup = Get-PropertyValue -Object $session -Names @('setup')
$settings = Get-PropertyValue -Object $setup -Names @('settings')

$resumeMarkdown = @(
  Redact-Text (Get-PropertyValue -Object $resumeContext -Names @('professionalSkills'))
  Redact-Text (Get-PropertyValue -Object $resumeContext -Names @('projectExperience'))
) -join "`n`n"
$jobDescriptionMarkdown = Redact-Text (Get-PropertyValue -Object $resumeContext -Names @('jobDescription'))

$case = [ordered]@{
  case_id = "draft-$($resolvedThreadId)"
  redaction_version = 'v1'
  source_type = 'redacted-production'
  source_thread_id_hash = "sha256:$(Get-Sha256Hex $resolvedThreadId)"
  resume_markdown = $resumeMarkdown.Trim()
  job_description_markdown = $jobDescriptionMarkdown.Trim()
  settings = if ($settings) { $settings } else { [ordered]@{} }
  turns = @()
  expected_stage_path = @('initialization')
  expected_required_skills = @()
  must_not_claim = @()
  rubric = [ordered]@{
    review_required = $true
    source_artifact = $artifact
    parse_error = $parseError
  }
  review_required = $true
}

New-Item -ItemType Directory -Force -Path $outputRootPath | Out-Null
$safeThreadId = [regex]::Replace($resolvedThreadId, '[^A-Za-z0-9_.-]', '-')
$outputPath = Join-Path $outputRootPath "$safeThreadId-interview-case-draft.json"
$case | ConvertTo-Json -Depth 20 | Set-Content -Path $outputPath -Encoding UTF8

$piiCheckText = @(
  $case.resume_markdown
  $case.job_description_markdown
  ($case.turns | ConvertTo-Json -Depth 20)
  ($case.must_not_claim | ConvertTo-Json -Depth 20)
) -join "`n"
if ($piiCheckText -match '\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b' -or
    $piiCheckText -match '(?<!\d)(?:\+?\d[\d .-]{8,}\d)(?!\d)') {
  throw "PII pattern check failed for exported draft: $outputPath"
}

Write-Host "Eval case draft written to $outputPath" -ForegroundColor Green
