# Test Lambda function immediately

Write-Host "Testing Bedrock Model Monitor..." -ForegroundColor Cyan

# Get function name from CloudFormation stack
$functionName = aws cloudformation describe-stacks --stack-name bedrock-model-monitor --query 'Stacks[0].Outputs[?OutputKey==`FunctionName`].OutputValue' --output text 2>$null

if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($functionName)) {
    Write-Host "Error: Stack not found. Please deploy first." -ForegroundColor Red
    exit 1
}

Write-Host "Function: $functionName" -ForegroundColor Cyan

aws lambda invoke `
  --function-name $functionName `
  response.json

Write-Host "`nResponse:" -ForegroundColor Green
Get-Content response.json | ConvertFrom-Json | ConvertTo-Json -Depth 10

# Get email from stack
$emailAddress = aws cloudformation describe-stacks --stack-name bedrock-model-monitor --query 'Stacks[0].Parameters[?ParameterKey==`EmailAddress`].ParameterValue' --output text 2>$null

if ($emailAddress) {
    Write-Host "`nCheck your email at $emailAddress" -ForegroundColor Yellow
}
