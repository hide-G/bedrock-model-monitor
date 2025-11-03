# Bedrock Model Monitor

[![Built with Kiro](https://img.shields.io/badge/Built%20with-Kiro-blue)](https://kiro.ai)

[English](#english) | [日本語](#japanese)

---

## English

Monitor Amazon Bedrock for new foundation models and get instant email notifications when they're released.

> **Note**: This project was developed using [Kiro](https://kiro.ai), an AI-powered IDE for developers.

### Features

- 🔍 Checks Bedrock every 10 minutes for new models
- 📧 Email notifications with detailed model information
- 💾 Tracks known models in DynamoDB
- ⚡ Serverless architecture (Lambda + EventBridge)
- 💰 Low cost (mostly free tier eligible)

### Architecture

- **Lambda**: Fetches model list from Bedrock API and compares with DynamoDB
- **DynamoDB**: Stores known models
- **EventBridge**: Triggers Lambda every 10 minutes
- **SES**: Sends email notifications for new models

### Prerequisites

- AWS CLI configured with credentials
- AWS SAM CLI installed
- Node.js 20.x or later
- An email address for notifications

### Tested Environment

- Windows 10
- PowerShell 5.1+
- AWS CLI 2.x
- AWS SAM CLI 1.144.0+
- Node.js 20.x

### Quick Start

#### Deploy

**Windows PowerShell:**
```powershell
.\deploy.ps1
```

**Linux/Mac:**
```bash
chmod +x deploy.sh
./deploy.sh
```

The script will:
1. Prompt for your email address
2. Verify the email with AWS SES (check your inbox)
3. Build and deploy the stack

#### First Run

On first deployment, you'll receive an email with all currently available Bedrock models (~105 models).
After that, you'll only be notified of new models.

### Management Commands

**Update Email Address:**
```powershell
.\update-email.ps1
```

**Test Immediately (AWS):**
```powershell
.\test-now.ps1
```
Triggers the deployed Lambda function on AWS and sends a real email notification.

**Test Locally (Development):**
```powershell
.\test-local.ps1
```
Runs the Lambda function code locally without deploying. Useful for testing code changes before deployment.

**View Logs:**
```powershell
aws logs tail /aws/lambda/bedrock-model-monitor-MonitorFunction --follow
```

**Delete Everything:**
```powershell
.\destroy.ps1
```

### Cost Estimate

- **Lambda**: ~4,320 invocations/month - Free tier covers 1M requests
- **DynamoDB**: On-demand pricing - Minimal cost for small dataset
- **SES**: First 62,000 emails/month free
- **EventBridge**: First 14M events/month free

**Estimated monthly cost: $0-1**

### Email Notification Example

```
Amazon Bedrockに新しいモデルがリリースされました！

検出日時: 2025-11-04 10:30:00
新モデル数: 3

【新モデル一覧】
- GPT-4o (openai.gpt-4o-v1:0)
  Provider: OpenAI
  Input: TEXT
  Output: TEXT
  Streaming: Yes
```

### Troubleshooting

**Email not verified:**
Check your inbox for AWS SES verification email and click the link.

**No notifications:**
- Check Lambda logs
- Verify EventBridge rule is enabled in AWS Console

**Permission errors:**
Ensure your AWS credentials have permissions for Lambda, DynamoDB, SES, EventBridge, and CloudFormation.

### License

MIT

---

## Japanese

Amazon Bedrockの新しい基盤モデルを監視し、リリースされたら即座にメール通知を受け取るシステムです。

> **注記**: このプロジェクトは、AI搭載の開発環境 [Kiro](https://kiro.ai) を使用して開発されました。

### 機能

- 🔍 10分毎にBedrockの新モデルをチェック
- 📧 詳細なモデル情報をメールで通知
- 💾 既知のモデルをDynamoDBで管理
- ⚡ サーバーレスアーキテクチャ（Lambda + EventBridge）
- 💰 低コスト（ほぼ無料枠内で運用可能）

### アーキテクチャ

- **Lambda**: Bedrock APIからモデル一覧を取得し、DynamoDBと比較
- **DynamoDB**: 既知のモデルを保存
- **EventBridge**: 10分毎にLambdaを起動
- **SES**: 新モデル検出時にメール送信

### 前提条件

- AWS CLIの設定（認証情報）
- AWS SAM CLIのインストール
- Node.js 20.x以降
- 通知用のメールアドレス

### 動作確認環境

- Windows 10
- PowerShell 5.1以降
- AWS CLI 2.x
- AWS SAM CLI 1.144.0以降
- Node.js 20.x

### クイックスタート

#### デプロイ

**Windows PowerShell:**
```powershell
.\deploy.ps1
```

**Linux/Mac:**
```bash
chmod +x deploy.sh
./deploy.sh
```

スクリプトは以下を実行します：
1. メールアドレスの入力を求める
2. AWS SESでメールを検証（受信トレイを確認）
3. スタックをビルド＆デプロイ

#### 初回実行

初回デプロイ時は、現在利用可能な全Bedrockモデル（約105個）がメールで届きます。
その後は新しいモデルのみが通知されます。

### 管理コマンド

**メールアドレスを変更:**
```powershell
.\update-email.ps1
```

**即座にテスト実行（AWS上）:**
```powershell
.\test-now.ps1
```
デプロイ済みのLambda関数をAWS上で実行し、実際にメール通知を送信します。

**ローカルテスト（開発用）:**
```powershell
.\test-local.ps1
```
Lambda関数のコードをデプロイせずにローカルで実行します。コード変更後のテストに便利です。

**ログを確認:**
```powershell
aws logs tail /aws/lambda/bedrock-model-monitor-MonitorFunction --follow
```

**すべて削除:**
```powershell
.\destroy.ps1
```

### コスト見積もり

- **Lambda**: 月間約4,320回実行 - 無料枠で100万リクエストまでカバー
- **DynamoDB**: オンデマンド料金 - 小規模データセットのため最小コスト
- **SES**: 月間62,000通まで無料
- **EventBridge**: 月間1,400万イベントまで無料

**月間推定コスト: $0〜1**

### メール通知の例

```
Amazon Bedrockに新しいモデルがリリースされました！

検出日時: 2025-11-04 10:30:00
新モデル数: 3

【新モデル一覧】
- GPT-4o (openai.gpt-4o-v1:0)
  Provider: OpenAI
  Input: TEXT
  Output: TEXT
  Streaming: Yes
```

### トラブルシューティング

**メールが検証されない:**
受信トレイでAWS SESからの検証メールを確認し、リンクをクリックしてください。

**通知が来ない:**
- Lambdaのログを確認
- AWSコンソールでEventBridgeルールが有効になっているか確認

**権限エラー:**
AWS認証情報にLambda、DynamoDB、SES、EventBridge、CloudFormationの権限があることを確認してください。

### ライセンス

MIT

### 貢献

プルリクエスト歓迎！
