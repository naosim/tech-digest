$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Push-Location $projectRoot

try {
  $null = & git rev-parse --show-toplevel
  if ($LASTEXITCODE -ne 0) {
    throw 'This script must be run from a Git repository.'
  }

  $stagedFiles = @(& git diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to inspect staged Git changes.'
  }
  if ($stagedFiles.Count -gt 0) {
    throw "Refusing to continue because changes are already staged: $($stagedFiles -join ', ')"
  }

  & npm.cmd run summarize:local
  if ($LASTEXITCODE -ne 0) {
    throw 'Local summarization failed; no commit or push was performed.'
  }

  & git add -- articles.json
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to stage articles.json.'
  }

  $stagedFiles = @(& git diff --cached --name-only)
  if ($LASTEXITCODE -ne 0) {
    throw 'Unable to verify staged Git changes.'
  }
  if ($stagedFiles.Count -eq 0) {
    Write-Output 'No article data changed; nothing to commit.'
    return
  }
  if ($stagedFiles.Count -ne 1 -or $stagedFiles[0] -ne 'articles.json') {
    throw "Refusing to commit unexpected staged files: $($stagedFiles -join ', ')"
  }

  $commitMessage = @'
chore: summarize pending articles

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
'@
  & git commit -m $commitMessage
  if ($LASTEXITCODE -ne 0) {
    throw 'Git commit failed; changes were not pushed.'
  }

  & git push
  if ($LASTEXITCODE -ne 0) {
    throw 'Git push failed. The local commit is preserved; resolve the remote issue and push again.'
  }
}
finally {
  Pop-Location
}
