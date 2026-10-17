$ErrorActionPreference = "Stop"
$workerDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $workerDirectory

$config = Get-Content -LiteralPath "wrangler.jsonc" -Raw
if ($config.Contains("PASTE_D1_DATABASE_ID_HERE")) {
    Write-Host "Open wrangler.jsonc and replace PASTE_D1_DATABASE_ID_HERE with the D1 database ID first." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path -LiteralPath "node_modules")) {
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

npm test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx wrangler d1 execute fo-monthly-bulletin-data --remote --file=schema.sql
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx wrangler deploy
exit $LASTEXITCODE
