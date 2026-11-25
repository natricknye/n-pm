$ErrorActionPreference = 'Stop'
$secret = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))"
$url = 'https://pm.natricknye.cn/api/github/webhook'
$ok = $false
for ($i = 0; $i -lt 5; $i++) {
  $secret | npx --yes vercel@66.2.0 env add GITHUB_WEBHOOK_SECRET production --sensitive --yes --force
  if ($LASTEXITCODE -eq 0) { $ok = $true; break }
  Start-Sleep -Seconds 3
}
if (-not $ok) { throw 'failed to update GITHUB_WEBHOOK_SECRET' }

$repos = gh repo list natricknye --limit 100 --json name --jq '.[].name'
foreach ($repo in $repos) {
  $raw = gh api "repos/natricknye/$repo/hooks" 2>$null
  if ($LASTEXITCODE -ne 0) { "list failed: $repo"; continue }
  $hooks = @()
  if ($raw) { $hooks = @($raw | ConvertFrom-Json) }
  $existing = $hooks | Where-Object { $_.config.url -eq $url } | Select-Object -First 1
  $body = @{
    name = 'web'
    active = $true
    events = @('push', 'repository', 'release', 'public', 'fork')
    config = @{
      url = $url
      content_type = 'json'
      secret = $secret
      insecure_ssl = '0'
    }
  } | ConvertTo-Json -Depth 5 -Compress
  if ($existing) {
    $body | gh api "repos/natricknye/$repo/hooks/$($existing.id)" --method PATCH --input - | Out-Null
    if ($LASTEXITCODE -eq 0) { "hook updated: $repo" } else { "hook update failed: $repo" }
  } else {
    $body | gh api "repos/natricknye/$repo/hooks" --method POST --input - | Out-Null
    if ($LASTEXITCODE -eq 0) { "hook created: $repo" } else { "hook create failed: $repo" }
  }
}
