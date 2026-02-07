const { BedrockClient, ListFoundationModelsCommand } = require('@aws-sdk/client-bedrock');
const { EC2Client, DescribeRegionsCommand } = require('@aws-sdk/client-ec2');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const ec2 = new EC2Client({});
const dynamoClient = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(dynamoClient);
const ses = new SESClient({});
const sns = new SNSClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const EMAIL_ADDRESS = process.env.EMAIL_ADDRESS;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;

// Bedrockドキュメントリンク
const BEDROCK_DOCS_URL = 'https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html';
const BEDROCK_PRICING_URL = 'https://aws.amazon.com/bedrock/pricing/';
const BEDROCK_CONSOLE_BASE = 'https://console.aws.amazon.com/bedrock/home';

/**
 * リージョンコードを人間が読みやすい名前に変換するマップ
 */
const REGION_DISPLAY_NAMES = {
  'us-east-1': 'US East (N. Virginia)',
  'us-east-2': 'US East (Ohio)',
  'us-west-1': 'US West (N. California)',
  'us-west-2': 'US West (Oregon)',
  'af-south-1': 'Africa (Cape Town)',
  'ap-east-1': 'Asia Pacific (Hong Kong)',
  'ap-south-1': 'Asia Pacific (Mumbai)',
  'ap-south-2': 'Asia Pacific (Hyderabad)',
  'ap-southeast-1': 'Asia Pacific (Singapore)',
  'ap-southeast-2': 'Asia Pacific (Sydney)',
  'ap-southeast-3': 'Asia Pacific (Jakarta)',
  'ap-southeast-4': 'Asia Pacific (Melbourne)',
  'ap-northeast-1': 'Asia Pacific (Tokyo)',
  'ap-northeast-2': 'Asia Pacific (Seoul)',
  'ap-northeast-3': 'Asia Pacific (Osaka)',
  'ca-central-1': 'Canada (Central)',
  'ca-west-1': 'Canada West (Calgary)',
  'eu-central-1': 'Europe (Frankfurt)',
  'eu-central-2': 'Europe (Zurich)',
  'eu-west-1': 'Europe (Ireland)',
  'eu-west-2': 'Europe (London)',
  'eu-west-3': 'Europe (Paris)',
  'eu-south-1': 'Europe (Milan)',
  'eu-south-2': 'Europe (Spain)',
  'eu-north-1': 'Europe (Stockholm)',
  'il-central-1': 'Israel (Tel Aviv)',
  'me-south-1': 'Middle East (Bahrain)',
  'me-central-1': 'Middle East (UAE)',
  'sa-east-1': 'South America (São Paulo)',
};

/**
 * リージョンコードを表示名付きの文字列に変換
 */
function formatRegion(regionCode) {
  const displayName = REGION_DISPLAY_NAMES[regionCode];
  return displayName ? `${regionCode} (${displayName})` : regionCode;
}

/**
 * モデルIDからBedrockコンソールURLを生成
 */
function getConsoleUrl(region) {
  return `${BEDROCK_CONSOLE_BASE}?region=${region}#/models`;
}

exports.handler = async (event) => {
  console.log('Bedrock Model Monitor 開始');
  console.log('Event:', JSON.stringify(event));

  // 手動テスト実行かどうかを判定
  const isManualTest = !event.source || event.source !== 'aws.events';

  try {
    // 1. 全リージョンからBedrockモデル一覧を取得
    const { models: currentModels, bedrockRegionCount, totalRegionCount } = await fetchBedrockModelsAllRegions();
    console.log(`全リージョンから ${currentModels.length} 件のモデルを検出（Bedrock対応: ${bedrockRegionCount}/${totalRegionCount}リージョン）`);

    // 2. DynamoDBから既知のモデル一覧を取得
    const knownModels = await fetchKnownModels();
    console.log(`DynamoDBに ${knownModels.size} 件の既知モデルあり`);

    // 3. 新しいモデルを検出
    const newModels = currentModels.filter(model => !knownModels.has(model.modelId));

    if (newModels.length > 0) {
      console.log(`🎉 ${newModels.length} 件の新モデルを検出！`);

      // 4. 新モデルをDynamoDBに保存
      await saveNewModels(newModels);

      // 5. メール通知を送信
      await sendEmailNotification(newModels, false, bedrockRegionCount);

      // 6. SNS通知を送信（Slack/Teams連携用）
      await publishToSns(newModels, bedrockRegionCount);

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: `${newModels.length} new model(s) detected`,
          newModels: newModels.map(m => ({ modelId: m.modelId, regions: m.regions }))
        })
      };
    } else {
      console.log('新しいモデルはありません');

      if (isManualTest) {
        console.log('手動テスト検出 - ステータスメールを送信');
        await sendEmailNotification([], true, bedrockRegionCount);
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: 'No new models - status email sent (manual test)',
            totalModels: currentModels.length,
            bedrockRegions: bedrockRegionCount
          })
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No new models' })
      };
    }
  } catch (error) {
    console.error('エラー:', error);
    throw error;
  }
};

/**
 * EC2 DescribeRegionsで全AWSリージョンを動的に取得する
 */
async function fetchAllAwsRegions() {
  const command = new DescribeRegionsCommand({ AllRegions: false });
  const response = await ec2.send(command);
  const regions = response.Regions.map(r => r.RegionName);
  console.log(`AWS全リージョン数: ${regions.length}`);
  return regions;
}

/**
 * 全AWSリージョンからBedrockモデルを取得し、リージョン情報を付与する
 * EC2 DescribeRegionsで動的にリージョン一覧を取得するため、
 * 新リージョンが追加されても自動的に対応できる
 */
async function fetchBedrockModelsAllRegions() {
  const modelMap = new Map();

  // 全AWSリージョンを動的に取得
  const allRegions = await fetchAllAwsRegions();

  const regionPromises = allRegions.map(async (region) => {
    try {
      const client = new BedrockClient({ region });
      const command = new ListFoundationModelsCommand({});
      const response = await client.send(command);
      return { region, models: response.modelSummaries || [] };
    } catch (error) {
      // Bedrockが利用不可のリージョンはスキップ（エラーは正常動作）
      return { region, models: [] };
    }
  });

  const results = await Promise.all(regionPromises);

  const bedrockRegionCount = results.filter(r => r.models.length > 0).length;
  console.log(`Bedrockが利用可能なリージョン数: ${bedrockRegionCount} / ${allRegions.length}`);

  for (const { region, models } of results) {
    for (const model of models) {
      if (modelMap.has(model.modelId)) {
        modelMap.get(model.modelId).regions.push(region);
      } else {
        modelMap.set(model.modelId, {
          modelId: model.modelId,
          modelName: model.modelName,
          providerName: model.providerName,
          inputModalities: model.inputModalities,
          outputModalities: model.outputModalities,
          responseStreamingSupported: model.responseStreamingSupported,
          customizationsSupported: model.customizationsSupported,
          inferenceTypesSupported: model.inferenceTypesSupported,
          regions: [region],
          detectedAt: new Date().toISOString()
        });
      }
    }
  }

  return {
    models: Array.from(modelMap.values()),
    bedrockRegionCount,
    totalRegionCount: allRegions.length
  };
}

async function fetchKnownModels() {
  const items = [];
  let lastEvaluatedKey;

  do {
    const command = new ScanCommand({
      TableName: TABLE_NAME,
      ProjectionExpression: 'modelId',
      ...(lastEvaluatedKey && { ExclusiveStartKey: lastEvaluatedKey })
    });
    const response = await dynamo.send(command);
    items.push(...response.Items);
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return new Set(items.map(item => item.modelId));
}

async function saveNewModels(models) {
  const promises = models.map(model =>
    dynamo.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: model
    }))
  );
  await Promise.all(promises);
  console.log(`${models.length} 件の新モデルをDynamoDBに保存`);
}

/**
 * メール通知を送信（英語 → 日本語の順で記載）
 * ドキュメントリンク・コンソールリンク付き
 */
async function sendEmailNotification(newModels, isStatusCheck, bedrockRegionCount) {
  let subject, emailBody;
  const now = new Date();
  const timeEn = now.toLocaleString('en-US', { timeZone: 'UTC' });
  const timeJa = now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  if (isStatusCheck) {
    subject = '✅ Bedrock Model Monitor - Status Check / 動作確認';
    emailBody = `[English]
Bedrock Model Monitor is running normally.

Check Time: ${timeEn} (UTC)
Status: OK
Bedrock Available Regions: ${bedrockRegionCount}
New Models: None

The system continues to check automatically.

📖 Supported Models: ${BEDROCK_DOCS_URL}
💰 Pricing: ${BEDROCK_PRICING_URL}

---

[日本語]
Bedrock Model Monitorは正常に動作しています。

確認日時: ${timeJa} (JST)
ステータス: 正常
Bedrock利用可能リージョン数: ${bedrockRegionCount}
新モデル: なし

システムは自動的にチェックを続けています。

📖 対応モデル一覧: ${BEDROCK_DOCS_URL}
💰 料金: ${BEDROCK_PRICING_URL}

---
Sent by Bedrock Model Monitor / Bedrock Model Monitorから自動送信
`;
  } else {
    // 英語版モデル一覧
    const modelListEn = newModels.map(model => {
      const regionLines = model.regions.map(r => `    - ${formatRegion(r)}`).join('\n');
      const firstRegion = model.regions[0];
      return `■ ${model.modelName} is now available in ${model.regions.length} region(s).
  Model ID: ${model.modelId}
  Provider: ${model.providerName}
  Input: ${model.inputModalities.join(', ')}
  Output: ${model.outputModalities.join(', ')}
  Streaming: ${model.responseStreamingSupported ? 'Yes' : 'No'}
  Console: ${getConsoleUrl(firstRegion)}
  Regions:
${regionLines}`;
    }).join('\n\n');

    // 日本語版モデル一覧
    const modelListJa = newModels.map(model => {
      const regionLines = model.regions.map(r => `    - ${formatRegion(r)}`).join('\n');
      const firstRegion = model.regions[0];
      return `■ ${model.regions.length}個のリージョンで ${model.modelName} が使えるようになりました。
  モデルID: ${model.modelId}
  プロバイダー: ${model.providerName}
  入力: ${model.inputModalities.join(', ')}
  出力: ${model.outputModalities.join(', ')}
  ストリーミング: ${model.responseStreamingSupported ? '対応' : '非対応'}
  コンソール: ${getConsoleUrl(firstRegion)}
  リージョン詳細:
${regionLines}`;
    }).join('\n\n');

    subject = `🎉 ${newModels.length} New Bedrock Model(s) Detected / Bedrock新モデル${newModels.length}件検出`;
    emailBody = `[English]
New generative AI model(s) have been released on Amazon Bedrock!

Detection Time: ${timeEn} (UTC)
New Models: ${newModels.length}
Bedrock Available Regions: ${bedrockRegionCount}

--- New Model Details ---

${modelListEn}

📖 Full Model List: ${BEDROCK_DOCS_URL}
💰 Pricing: ${BEDROCK_PRICING_URL}

---

[日本語]
Amazon Bedrockに新しい生成AIモデルがリリースされました！

検出日時: ${timeJa} (JST)
新モデル数: ${newModels.length}
Bedrock利用可能リージョン数: ${bedrockRegionCount}

--- 新モデル詳細 ---

${modelListJa}

📖 対応モデル一覧: ${BEDROCK_DOCS_URL}
💰 料金: ${BEDROCK_PRICING_URL}

---
Sent by Bedrock Model Monitor / Bedrock Model Monitorから自動送信
`;
  }

  const command = new SendEmailCommand({
    Source: EMAIL_ADDRESS,
    Destination: { ToAddresses: [EMAIL_ADDRESS] },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Text: { Data: emailBody, Charset: 'UTF-8' } }
    }
  });

  await ses.send(command);
  console.log('メール通知を送信しました');
}

/**
 * SNS Topicに通知を発行（Slack/Teams/Lambda連携用）
 * JSON形式で構造化データを送信するため、外部連携しやすい
 */
async function publishToSns(newModels, bedrockRegionCount) {
  if (!SNS_TOPIC_ARN) {
    console.log('SNS_TOPIC_ARNが未設定のためSNS通知をスキップ');
    return;
  }

  const payload = {
    source: 'bedrock-model-monitor',
    detectedAt: new Date().toISOString(),
    bedrockRegionCount,
    newModelCount: newModels.length,
    models: newModels.map(model => ({
      modelId: model.modelId,
      modelName: model.modelName,
      providerName: model.providerName,
      regionCount: model.regions.length,
      regions: model.regions,
      inputModalities: model.inputModalities,
      outputModalities: model.outputModalities,
      streaming: model.responseStreamingSupported,
      docsUrl: BEDROCK_DOCS_URL,
      consoleUrl: getConsoleUrl(model.regions[0])
    })),
    // Slack/Teams向けのサマリーテキスト
    summary: newModels.map(m =>
      `🆕 ${m.modelName} (${m.providerName}) - ${m.regions.length} region(s): ${m.regions.join(', ')}`
    ).join('\n')
  };

  const command = new PublishCommand({
    TopicArn: SNS_TOPIC_ARN,
    Subject: `Bedrock New Model(s): ${newModels.length} detected`,
    Message: JSON.stringify(payload, null, 2)
  });

  await sns.send(command);
  console.log('SNS通知を送信しました');
}
