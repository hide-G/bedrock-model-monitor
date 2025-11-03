# Destroy Bedrock Model Monitor

Write-Host "=== Bedrock Model Monitor Cleanup ===" -ForegroundColor Yellow

Write-Host "`nThis will delete all AWS resources including:" -ForegroundColor Yellow
Write-Host "  - Lambda function" -ForegroundColor Yellow
Write-Host "  - DynamoDB table (all model data)" -ForegroundColor Yellow
Write-Host "  - EventBridge schedule" -ForegroundColor Yellow
Write-Host "  - IAM roles" -ForegroundColor Yellow

$confirmation = Read-Host "`nAre you sure you want to delete everything? (yes/no)"

if ($confirmation -ne "yes") {
    Write-Host "Cancelled" -ForegroundColor Cyan
    exit 0
}

Write-Host "`nDeleting CloudFormation stack..." -ForegroundColor Cyan
aws cloudformation delete-stack --stack-name bedrock-model-monitor

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to initiate stack deletion" -ForegroundColor Red
    exit 1
}

Write-Host "Stack deletion initiated. Waiting for completion..." -ForegroundColor Cyan
aws cloudformation wait stack-delete-complete --stack-name bedrock-model-monitor

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nAll resources deleted successfully!" -ForegroundColor Green
    
    # Clean up local files
    if (Test-Path ".aws-sam") {
        Remove-Item -Recurse -Force ".aws-sam"
        Write-Host "Cleaned up local build artifacts" -ForegroundColor Green
    }
    
    if (Test-Path "response.json") {
        Remove-Item "response.json"
    }
    
    Write-Host "`nNote: SES email verification is still active." -ForegroundColor Cyan
    Write-Host "To remove it, run: aws ses delete-identity --identity <your-email>" -ForegroundColor Cyan
}
else {
    Write-Host "`nStack deletion failed or timed out" -ForegroundColor Red
    Write-Host "Check AWS Console for details" -ForegroundColor Yellow
    exit 1
}
