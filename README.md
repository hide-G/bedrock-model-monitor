# Bedrock Model Monitor

> Detect new Amazon Bedrock foundation models across **all AWS regions** and get instant bilingual (English/Japanese) notifications — with one-click deployment.

[English](#english) | [日本語](#japanese)

---

## English

### Why Bedrock Model Monitor?

Amazon Bedrock frequently adds new generative AI models, but there's no built-in notification when a new model becomes available. This tool solves that by:

- Scanning **every AWS region dynamically** (no hardcoded region list)
- Detecting new models within **3 minutes** of release
- Telling you **exactly which regions** each model is available in
- Sending **bilingual notifications** (English + Japanese) with direct console links
- Deploying in **one click** — no CLI, no CDK, no bootstrap required

### One-Click Deploy (Launch Stack)

[![Launch Stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)](https://console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=bedrock-model-monitor&templateURL=https://YOUR_BUCKET.s3.amazonaws.com/bedrock-model-monitor/template.yaml)

> After clicking, you'll be prompted to enter your email address. Two confirmation emails will arrive — click both links to activate notifications.

### Architecture

```
EventBridge Scheduler (every 3 min)
        │
        ▼
  Lambda Function (Node.js 20)
        ├── EC2 DescribeRegions (get ALL AWS regions dynamically)
        ├── Bedrock ListFoundationModels (parallel across all regions)
        ├── DynamoDB (diff detection)
        └── New model found?
              ├── Yes → SES Email (bilingual EN/JP with docs links)
              │         SNS Topic (JSON payload for Slack/Teams/Lambda)
              └── No  → Done
```

| Component | Role |
|-----------|------|
| Lambda | Scans all AWS regions for Bedrock models, compares with DynamoDB |
| DynamoDB | Stores known models with region availability |
| EventBridge | Triggers Lambda on schedule (default: every 3 minutes) |
| SES | Sends bilingual email notifications with documentation links |
| SNS Topic | Publishes structured JSON for Slack/Teams/Lambda integrations |

### Key Differentiators

| Feature | Bedrock Model Monitor | Typical Alternatives |
|---------|----------------------|---------------------|
| Region Coverage | **All AWS regions (dynamic)** | 3 regions (hardcoded) |
| Detection Speed | **3 minutes** (configurable) | 1-10 minutes |
| Language | **Bilingual (EN + JP)** | Single language |
| Deployment | **One-click (Launch Stack)** | CDK + bootstrap required |
| External Dependencies | **None** | Tavily API key, etc. |
| Slack/Teams Ready | **SNS Topic included** | Manual setup |
| Documentation Links | **Auto-included** | Not included |
| Cost | **$0-1/month** | Varies (AgentCore costs) |

### Email Notification Example

```
[English]
New generative AI model(s) have been released on Amazon Bedrock!

Detection Time: 2/7/2026, 10:30:00 AM (UTC)
New Models: 2
Bedrock Available Regions: 18

--- New Model Details ---

■ Claude 4 Opus is now available in 5 region(s).
  Model ID: anthropic.claude-4-opus-v1:0
  Provider: Anthropic
  Input: TEXT, IMAGE
  Output: TEXT
  Streaming: Yes
  Console: https://console.aws.amazon.com/bedrock/home?region=us-east-1#/models
  Regions:
    - us-east-1 (US East (N. Virginia))
    - us-west-2 (US West (Oregon))
    - eu-west-1 (Europe (Ireland))
    - ap-northeast-1 (Asia Pacific (Tokyo))
    - ap-southeast-1 (Asia Pacific (Singapore))

📖 Full Model List: https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html
💰 Pricing: https://aws.amazon.com/bedrock/pricing/

---

[日本語]
Amazon Bedrockに新しい生成AIモデルがリリースされました！

検出日時: 2026/2/7 19:30:00 (JST)
新モデル数: 2
Bedrock利用可能リージョン数: 18

--- 新モデル詳細 ---

■ 5個のリージョンで Claude 4 Opus が使えるようになりました。
  モデルID: anthropic.claude-4-opus-v1:0
  プロバイダー: Anthropic
  入力: TEXT, IMAGE
  出力: TEXT
  ストリーミング: 対応
  コンソール: https://console.aws.amazon.com/bedrock/home?region=us-east-1#/models
  リージョン詳細:
    - us-east-1 (US East (N. Virginia))
    - us-west-2 (US West (Oregon))
    - eu-west-1 (Europe (Ireland))
    - ap-northeast-1 (Asia Pacific (Tokyo))
    - ap-southeast-1 (Asia Pacific (Singapore))

📖 対応モデル一覧: https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html
💰 料金: https://aws.amazon.com/bedrock/pricing/
```

### SNS Integration (Slack / Teams / Lambda)

The stack creates an SNS Topic that publishes structured JSON when new models are detected. You can subscribe:

- **Slack**: Use AWS Chatbot or a Lambda function with Slack Incoming Webhook
- **Microsoft Teams**: Use a Lambda function with Teams Incoming Webhook
- **Custom Lambda**: Process the JSON payload for any custom workflow

SNS JSON payload example:
```json
{
  "source": "bedrock-model-monitor",
  "detectedAt": "2026-02-07T10:30:00.000Z",
  "bedrockRegionCount": 18,
  "newModelCount": 1,
  "models": [
    {
      "modelId": "anthropic.claude-4-opus-v1:0",
      "modelName": "Claude 4 Opus",
      "providerName": "Anthropic",
      "regionCount": 5,
      "regions": ["us-east-1", "us-west-2", "eu-west-1", "ap-northeast-1", "ap-southeast-1"],
      "docsUrl": "https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html",
      "consoleUrl": "https://console.aws.amazon.com/bedrock/home?region=us-east-1#/models"
    }
  ],
  "summary": "🆕 Claude 4 Opus (Anthropic) - 5 region(s): us-east-1, us-west-2, eu-west-1, ap-northeast-1, ap-southeast-1"
}
```

The SNS Topic ARN is available in the CloudFormation Outputs after deployment.

### Deploy with SAM CLI (Alternative)

```bash
# ビルド＆デプロイ（対話形式）
sam build && sam deploy --guided

# または直接指定
sam build && sam deploy --parameter-overrides EmailAddress=you@example.com
```

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| EmailAddress | *(required)* | Email for notifications (SES verification sent automatically) |
| CheckIntervalMinutes | 3 | Check interval in minutes (1-1440) |

### Management Commands (PowerShell)

| Command | Description |
|---------|-------------|
| `.\test-now.ps1` | Trigger Lambda on AWS (sends real notification) |
| `.\test-local.ps1` | Run Lambda locally for development |
| `.\update-email.ps1` | Update notification email address |
| `.\destroy.ps1` | Delete all AWS resources |

### Prerequisites (SAM CLI deploy only)

- AWS CLI configured
- AWS SAM CLI installed
- Node.js 20.x+

> Launch Stack deployment requires **no prerequisites** — just an AWS account.

### Launch Stack Setup (for repository maintainers)

To enable the one-click Launch Stack button for your fork:

1. Create an S3 bucket and package the template:
   ```bash
   aws s3 mb s3://your-template-bucket
   sam build
   sam package --output-template-file packaged.yaml \
     --s3-bucket your-template-bucket --s3-prefix bedrock-model-monitor
   aws s3 cp packaged.yaml \
     s3://your-template-bucket/bedrock-model-monitor/template.yaml
   aws s3api put-object-acl --bucket your-template-bucket \
     --key bedrock-model-monitor/template.yaml --acl public-read
   ```

2. Update the Launch Stack URL in this README with your bucket name.

**Automated:** Configure `TEMPLATE_BUCKET_NAME` and `AWS_ROLE_ARN` in GitHub Secrets, then push a version tag (`v1.0.0`).

### Cost Estimate

| Service | Usage | Cost |
|---------|-------|------|
| Lambda | ~14,400 invocations/month (3-min interval) | Free tier (1M requests) |
| DynamoDB | On-demand, small dataset | Minimal |
| SES | Email notifications | Free (first 62,000/month) |
| SNS | Topic notifications | Free (first 1M publishes) |
| EventBridge | Scheduled events | Free (first 14M/month) |

**Estimated monthly cost: $0-1**

### License

MIT

---

## Japanese

> Amazon Bedrockの新しい生成AIモデルを**全AWSリージョン横断**で自動検知し、リージョン情報付きのバイリンガル通知（英語・日本語）を即座に受け取れるサーバーレスアプリケーションです。ワンクリックでデプロイできます。

### なぜ Bedrock Model Monitor？

Amazon Bedrockには新しいモデルが頻繁に追加されますが、リリース通知の仕組みはありません。このツールは:

- **全AWSリージョンを動的にスキャン**（ハードコードなし、新リージョン自動対応）
- リリースから**3分以内**に検出
- 各モデルが**どのリージョンで利用可能か**を正確に通知
- **英語＋日本語のバイリンガル通知**にドキュメントリンク付き
- **ワンクリックデプロイ** — CLI不要、CDK不要、bootstrap不要

### ワンクリックデプロイ（Launch Stack）

[![Launch Stack](https://s3.amazonaws.com/cloudformation-examples/cloudformation-launch-stack.png)](https://console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=bedrock-model-monitor&templateURL=https://YOUR_BUCKET.s3.amazonaws.com/bedrock-model-monitor/template.yaml)

> ボタンを押すとメールアドレスの入力画面が表示されます。デプロイ後、2通の確認メール（SES検証・SNSサブスクリプション）が届くので、両方のリンクをクリックしてください。

### アーキテクチャ

```
EventBridge Scheduler（3分毎）
        │
        ▼
  Lambda関数（Node.js 20）
        ├── EC2 DescribeRegions（全AWSリージョンを動的取得）
        ├── Bedrock ListFoundationModels（全リージョン並列実行）
        ├── DynamoDB（差分検出）
        └── 新モデル検出？
              ├── あり → SESメール（英語/日本語 + ドキュメントリンク）
              │          SNS Topic（JSON形式でSlack/Teams/Lambda連携）
              └── なし → 終了
```

| コンポーネント | 役割 |
|--------------|------|
| Lambda | 全AWSリージョンのBedrockモデルをスキャンし、DynamoDBと比較 |
| DynamoDB | 既知のモデルをリージョン情報付きで保存 |
| EventBridge | スケジュールでLambdaを起動（デフォルト: 3分毎） |
| SES | ドキュメントリンク付きバイリンガルメール送信 |
| SNS Topic | Slack/Teams/Lambda連携用の構造化JSONを発行 |

### 差別化ポイント

| 機能 | Bedrock Model Monitor | 一般的な代替ツール |
|------|----------------------|------------------|
| リージョンカバレッジ | **全AWSリージョン（動的）** | 3リージョン（固定） |
| 検出速度 | **3分**（設定可能） | 1〜10分 |
| 言語 | **バイリンガル（英語＋日本語）** | 単一言語 |
| デプロイ | **ワンクリック（Launch Stack）** | CDK + bootstrap必須 |
| 外部依存 | **なし** | Tavily APIキー等 |
| Slack/Teams対応 | **SNS Topic同梱** | 手動設定 |
| ドキュメントリンク | **自動付与** | なし |
| コスト | **月額$0〜1** | 変動（AgentCoreコスト等） |

### パラメータ

| パラメータ | デフォルト | 説明 |
|-----------|----------|------|
| EmailAddress | *（必須）* | 通知先メールアドレス（SES検証は自動送信） |
| CheckIntervalMinutes | 3 | チェック間隔（分）（1〜1440） |

### SNS連携（Slack / Teams / Lambda）

スタックにはSNS Topicが含まれており、新モデル検出時に構造化JSONを発行します。以下と連携可能:

- **Slack**: AWS ChatbotまたはSlack Incoming Webhook + Lambda
- **Microsoft Teams**: Teams Incoming Webhook + Lambda
- **カスタムLambda**: JSONペイロードを処理して任意のワークフローを実行

SNS Topic ARNはデプロイ後のCloudFormation Outputsで確認できます。

### SAM CLIでデプロイ（代替方法）

```bash
sam build && sam deploy --guided
```

### 管理コマンド（PowerShell）

| コマンド | 説明 |
|---------|------|
| `.\test-now.ps1` | AWS上でLambdaを実行（実際に通知送信） |
| `.\test-local.ps1` | ローカルでLambdaを実行（開発用） |
| `.\update-email.ps1` | 通知先メールアドレスを変更 |
| `.\destroy.ps1` | 全AWSリソースを削除 |

### コスト見積もり

| サービス | 使用量 | コスト |
|---------|-------|-------|
| Lambda | 月間約14,400回実行（3分間隔） | 無料枠（100万リクエスト） |
| DynamoDB | オンデマンド、小規模データ | 最小 |
| SES | メール通知 | 無料（月間62,000通まで） |
| SNS | Topic通知 | 無料（月間100万パブリッシュまで） |
| EventBridge | スケジュールイベント | 無料（月間1,400万イベントまで） |

**月間推定コスト: $0〜1**

### ライセンス

MIT

### 貢献

プルリクエスト歓迎！ / Pull requests welcome!
