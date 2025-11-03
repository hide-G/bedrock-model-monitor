# Bedrock Model Monitor Deploy Script

Write-Host "=== Bedrock Model Monitor Deploy ===" -ForegroundColor Green

# Prompt for email address
$emailAddress = Read-Host "Enter your email address for notifications"

if ([string]::IsNullOrWhiteSpace($emailAddress)) {
    Write-Host "Error: Email address is required" -ForegroundColor Red
    exit 1
}

# Validate email format
if ($emailAddress -notmatch '^[\w\.-]+@[\w\.-]+\.\w+$') {
    Write-Host "Error: Invalid email format" -ForegroundColor Red
    exit 1
}

Write-Host "`nEmail address: $emailAddress" -ForegroundColor Cyan

# Check SES email verification
Write-Host "Checking SES email verification..." -ForegroundColor Cyan
$emailStatusJson = aws ses get-identity-verification-attributes --identities $emailAddress 2>$null | ConvertFrom-Json
$emailStatus = $emailStatusJson.VerificationAttributes.$emailAddress.VerificationStatus

if ($emailStatus -ne "Success") {
    Write-Host "Email not verified. Sending verification email..." -ForegroundColor Yellow
    aws ses verify-email-identity --email-address $emailAddress
    Write-Host "Verification email sent to $emailAddress" -ForegroundColor Yellow
    Write-Host "Please check your inbox and click the verification link" -ForegroundColor Yellow
    Write-Host "Then run this script again" -ForegroundColor Yellow
    exit 1
}

Write-Host "Email verified" -ForegroundColor Green

# Install Lambda dependencies
Write-Host "Installing Lambda dependencies..." -ForegroundColor Cyan
Push-Location lambda
npm install
Pop-Location

# SAM Build
Write-Host "Running SAM build..." -ForegroundColor Cyan
sam build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed" -ForegroundColor Red
    exit 1
}

# SAM Deploy
Write-Host "Running SAM deploy..." -ForegroundColor Cyan
sam deploy --stack-name bedrock-model-monitor --capabilities CAPABILITY_IAM --resolve-s3 --parameter-overrides EmailAddress=$emailAddress

if ($LASTEXITCODE -ne 0) {
    Write-Host "Deploy failed" -ForegroundColor Red
    exit 1
}

Write-Host "Deploy completed!" -ForegroundColor Green
Write-Host "The system will check Bedrock models every 10 minutes" -ForegroundColor Green
Write-Host "Check logs: aws logs tail /aws/lambda/bedrock-model-monitor-MonitorFunction --follow" -ForegroundColor Cyan
