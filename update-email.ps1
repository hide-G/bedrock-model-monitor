# Update Email Address Script

Write-Host "=== Update Email Address ===" -ForegroundColor Green

# Get current email
$currentStack = aws cloudformation describe-stacks --stack-name bedrock-model-monitor --query 'Stacks[0].Parameters[?ParameterKey==`EmailAddress`].ParameterValue' --output text 2>$null

if ($LASTEXITCODE -eq 0 -and $currentStack) {
    Write-Host "Current email: $currentStack" -ForegroundColor Cyan
}

# Prompt for new email address
$newEmail = Read-Host "Enter new email address for notifications"

if ([string]::IsNullOrWhiteSpace($newEmail)) {
    Write-Host "Error: Email address is required" -ForegroundColor Red
    exit 1
}

# Validate email format
if ($newEmail -notmatch '^[\w\.-]+@[\w\.-]+\.\w+$') {
    Write-Host "Error: Invalid email format" -ForegroundColor Red
    exit 1
}

# Check SES verification
Write-Host "`nChecking SES email verification..." -ForegroundColor Cyan
$emailStatusJson = aws ses get-identity-verification-attributes --identities $newEmail 2>$null | ConvertFrom-Json
$emailStatus = $emailStatusJson.VerificationAttributes.$newEmail.VerificationStatus

if ($emailStatus -ne "Success") {
    Write-Host "Email not verified. Sending verification email..." -ForegroundColor Yellow
    aws ses verify-email-identity --email-address $newEmail
    Write-Host "Verification email sent to $newEmail" -ForegroundColor Yellow
    Write-Host "Please check your inbox and click the verification link" -ForegroundColor Yellow
    Write-Host "Then run this script again" -ForegroundColor Yellow
    exit 1
}

Write-Host "Email verified" -ForegroundColor Green

# Update stack
Write-Host "`nUpdating CloudFormation stack..." -ForegroundColor Cyan
sam deploy --stack-name bedrock-model-monitor --capabilities CAPABILITY_IAM --resolve-s3 --parameter-overrides EmailAddress=$newEmail

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nEmail address updated successfully!" -ForegroundColor Green
    Write-Host "New notifications will be sent to: $newEmail" -ForegroundColor Cyan
}
else {
    Write-Host "`nUpdate failed" -ForegroundColor Red
    exit 1
}
