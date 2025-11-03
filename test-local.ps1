# ローカルテスト用スクリプト

Write-Host "Local Lambda function test" -ForegroundColor Cyan

# Prompt for email address
$emailAddress = Read-Host "Enter your email address for testing"

if ([string]::IsNullOrWhiteSpace($emailAddress)) {
    Write-Host "Error: Email address is required" -ForegroundColor Red
    exit 1
}

# Set environment variables
$env:TABLE_NAME = "bedrock-model-monitor-models"
$env:EMAIL_ADDRESS = $emailAddress
$env:AWS_REGION = "us-east-1"

# Install Lambda dependencies
Write-Host "`nInstalling dependencies..." -ForegroundColor Cyan
Set-Location lambda
if (-not (Test-Path "node_modules")) {
    npm install
}
Set-Location ..

# テストイベントを作成
$testEvent = @{
    source = "test"
} | ConvertTo-Json

# Run Lambda function
Write-Host "`nRunning Lambda function..." -ForegroundColor Cyan
node -e "const handler = require('./lambda/index.js').handler; handler($testEvent).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => console.error(e));"
