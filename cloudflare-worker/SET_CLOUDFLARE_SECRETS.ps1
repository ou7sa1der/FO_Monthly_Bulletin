$ErrorActionPreference = "Stop"
$workerDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $workerDirectory

function Set-WorkerSecret {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SecretName,
        [Parameter(Mandatory = $true)]
        [string]$Prompt
    )

    $secureValue = Read-Host $Prompt -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try {
        $plainValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        if ([string]::IsNullOrWhiteSpace($plainValue)) {
            throw "$SecretName cannot be empty."
        }
        $plainValue | npx wrangler secret put $SecretName
        if ($LASTEXITCODE -ne 0) {
            throw "Cloudflare rejected $SecretName."
        }
    }
    finally {
        if ($pointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
        $plainValue = $null
    }
}

if (-not (Test-Path -LiteralPath "node_modules")) {
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "The values stay hidden while you type and are sent directly to Cloudflare." -ForegroundColor Cyan
Set-WorkerSecret -SecretName "SLACK_BOT_TOKEN" -Prompt "Paste the Slack xoxb token"
Set-WorkerSecret -SecretName "TURNSTILE_SECRET" -Prompt "Paste the private Turnstile secret key"
Write-Host "Both Cloudflare secrets were saved." -ForegroundColor Green
