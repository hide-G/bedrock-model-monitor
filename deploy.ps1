# Bedrock Model Monitor デプロイスクリプト

Write-Host "=== Bedrock Model Monitor Deploy ===" -ForegroundColor Green

# メールアドレスの入力
$emailAddress = Read-Host "通知先メールアドレスを入力してください / Enter your email address for notifications"

if ([string]::IsNullOrWhiteSpace($emailAddress)) {
    Write-Host "エラー: メールアドレスは必須です" -ForegroundColor Red
    exit 1
}

# メールアドレスの形式チェック
if ($emailAddress -notmatch '^[\w\.\+\-]+@[\w\.\-]+\.\w+$') {
    Write-Host "エラー: 無効なメールアドレス形式です" -ForegroundColor Red
    exit 1
}

Write-Host "`nメールアドレス: $emailAddress" -ForegroundColor Cyan

# Lambda依存関係のインストール
Write-Host "`nLambda依存関係をインストール中..." -ForegroundColor Cyan
Push-Location lambda
npm install
Pop-Location

# SAMビルド
Write-Host "`nSAMビルド実行中..." -ForegroundColor Cyan
sam build

if ($LASTEXITCODE -ne 0) {
    Write-Host "ビルドに失敗しました" -ForegroundColor Red
    exit 1
}

# SAMデプロイ
Write-Host "`nSAMデプロイ実行中..." -ForegroundColor Cyan
sam deploy `
    --stack-name bedrock-model-monitor `
    --capabilities CAPABILITY_IAM `
    --resolve-s3 `
    --parameter-overrides EmailAddress=$emailAddress

if ($LASTEXITCODE -ne 0) {
    Write-Host "デプロイに失敗しました" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== デプロイ完了！ ===" -ForegroundColor Green
Write-Host ""
Write-Host "重要: $emailAddress にSES検証メールが届きます。" -ForegroundColor Yellow
Write-Host "受信トレイを確認し、検証リンクをクリックしてください。" -ForegroundColor Yellow
Write-Host "検証が完了するまでメール通知は送信されません。" -ForegroundColor Yellow
Write-Host ""
Write-Host "システムは ${CheckIntervalMinutes:-10} 分毎にBedrockモデルをチェックします" -ForegroundColor Green
Write-Host "ログ確認: aws logs tail /aws/lambda/bedrock-model-monitor-MonitorFunction --follow" -ForegroundColor Cyan
