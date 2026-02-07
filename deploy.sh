#!/bin/bash

# Bedrock Model Monitor デプロイスクリプト

echo "=== Bedrock Model Monitor Deploy ==="

# メールアドレスの入力
read -p "通知先メールアドレスを入力してください / Enter your email address: " EMAIL_ADDRESS

if [ -z "$EMAIL_ADDRESS" ]; then
    echo "エラー: メールアドレスは必須です"
    exit 1
fi

# メールアドレスの形式チェック
if ! [[ "$EMAIL_ADDRESS" =~ ^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$ ]]; then
    echo "エラー: 無効なメールアドレス形式です"
    exit 1
fi

echo ""
echo "メールアドレス: $EMAIL_ADDRESS"

# Lambda依存関係のインストール
echo ""
echo "Lambda依存関係をインストール中..."
cd lambda
npm install
cd ..

# SAMビルド
echo ""
echo "SAMビルド実行中..."
sam build

if [ $? -ne 0 ]; then
    echo "ビルドに失敗しました"
    exit 1
fi

# SAMデプロイ
echo ""
echo "SAMデプロイ実行中..."
sam deploy \
    --stack-name bedrock-model-monitor \
    --capabilities CAPABILITY_IAM \
    --resolve-s3 \
    --parameter-overrides EmailAddress="$EMAIL_ADDRESS"

if [ $? -ne 0 ]; then
    echo "デプロイに失敗しました"
    exit 1
fi

echo ""
echo "=== デプロイ完了！ ==="
echo ""
echo "重要: $EMAIL_ADDRESS にSES検証メールが届きます。"
echo "受信トレイを確認し、検証リンクをクリックしてください。"
echo "検証が完了するまでメール通知は送信されません。"
echo ""
echo "システムは10分毎にBedrockモデルをチェックします"
echo "ログ確認: aws logs tail /aws/lambda/bedrock-model-monitor-MonitorFunction --follow"
