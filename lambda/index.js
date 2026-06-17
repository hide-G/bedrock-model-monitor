const { BedrockClient, ListFoundationModelsCommand } = require('@aws-sdk/client-bedrock');
const { EC2Client, DescribeRegionsCommand } = require('@aws-sdk/client-ec2');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const { SignatureV4 } = require('@smithy/signature-v4');
const { HttpRequest } = require('@smithy/protocol-http');
const { Sha256 } = require('@aws-crypto/sha256-js');
const https = require('https');

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

// Bedrock Mantle対応リージョン一覧
// https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html
const MANTLE_REGIONS = [
  'us-east-1',
  'us-east-2',
  'us-west-2',
  'ap-south-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ap-northeast-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2',
  'eu-south-1',
  'eu-north-1',
  'sa-east-1',
];

// Mantle エンドポイントベースURL
const MANTLE_ENDPOINT_BASE = 'bedrock-mantle.{region}.api.aws';

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
    // 1. 全リージョンからBedrockモデル一覧を取得（従来のListFoundationModels API）
    const { models: currentModels, bedrockRegionCount, totalRegionCount } = await fetchBedrockModelsAllRegions();
    console.log(`全リージョンから ${currentModels.length} 件のモデルを検出（Bedrock対応: ${bedrockRegionCount}/${totalRegionCount}リージョン）`);

    // 1b. Bedrock Mantle エンドポイントからモデル一覧を取得
    const { models: mantleModels, mantleRegionCount } = await fetchMantleModelsAllRegions();
    console.log(`Mantleエンドポイントから ${mantleModels.length} 件のモデルを検出（${mantleRegionCount}リージョン）`);

    // 2. DynamoDBから既知のモデル一覧を取得
    const knownModels = await fetchKnownModels();
    console.log(`DynamoDBに ${knownModels.size} 件の既知モデルあり`);

    // 3. 新しいモデルを検出（従来のFoundationModels）
    const newModels = currentModels.filter(model => !knownModels.has(model.modelId));

    // 3b. 新しいMantleモデルを検出（mantle: プレフィックス付きで管理）
    const newMantleModels = mantleModels.filter(model => !knownModels.has(`mantle:${model.modelId}`));

    const totalNewCount = newModels.length + newMantleModels.length;

    if (totalNewCount > 0) {
      console.log(`🎉 ${totalNewCount} 件の新モデルを検出！（Foundation: ${newModels.length}, Mantle: ${newMantleModels.length}）`);

      // 4. 新モデルをDynamoDBに保存
      if (newModels.length > 0) {
        await saveNewModels(newModels);
      }
      if (newMantleModels.length > 0) {
        await saveNewMantleModels(newMantleModels);
      }

      // 5. メール通知を送信
      await sendEmailNotification(newModels, newMantleModels, false, bedrockRegionCount, mantleRegionCount);

      // 6. SNS通知を送信（Slack/Teams連携用）
      await publishToSns(newModels, newMantleModels, bedrockRegionCount, mantleRegionCount);

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: `${totalNewCount} new model(s) detected (Foundation: ${newModels.length}, Mantle: ${newMantleModels.length})`,
          newModels: newModels.map(m => ({ modelId: m.modelId, regions: m.regions })),
          newMantleModels: newMantleModels.map(m => ({ modelId: m.modelId, regions: m.regions }))
        })
      };
    } else {
      console.log('新しいモデルはありません');

      if (isManualTest) {
        console.log('手動テスト検出 - ステータスメールを送信');
        await sendEmailNotification([], [], true, bedrockRegionCount, mantleRegionCount);
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: 'No new models - status email sent (manual test)',
            totalModels: currentModels.length,
            totalMantleModels: mantleModels.length,
            bedrockRegions: bedrockRegionCount,
            mantleRegions: mantleRegionCount
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
 * SigV4署名付きHTTPリクエストを送信する
 */
async function signedHttpRequest(region, method, hostname, path) {
  const credentials = defaultProvider();
  const creds = await credentials();

  const signer = new SignatureV4({
    credentials: creds,
    region,
    service: 'bedrock-mantle',
    sha256: Sha256,
  });

  const request = new HttpRequest({
    method,
    protocol: 'https:',
    hostname,
    path,
    headers: {
      host: hostname,
      'content-type': 'application/json',
    },
  });

  const signedRequest = await signer.sign(request);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: signedRequest.hostname,
        path: signedRequest.path,
        method: signedRequest.method,
        headers: signedRequest.headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`JSONパースエラー: ${data.substring(0, 200)}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error('リクエストタイムアウト'));
    });
    req.end();
  });
}

/**
 * 単一リージョンのMantleエンドポイントからモデル一覧を取得する
 */
async function fetchMantleModelsForRegion(region) {
  const hostname = MANTLE_ENDPOINT_BASE.replace('{region}', region);
  try {
    const response = await signedHttpRequest(region, 'GET', hostname, '/v1/models');
    // OpenAI形式のレスポンス: { data: [{ id: "model-id", ... }, ...] }
    const models = response.data || [];
    return { region, models };
  } catch (error) {
    // Mantleが利用不可のリージョン、または権限エラーはスキップ
    console.log(`Mantle ${region}: スキップ (${error.message})`);
    return { region, models: [] };
  }
}

/**
 * 全Mantleリージョンからモデル一覧を取得し、リージョン情報を集約する
 */
async function fetchMantleModelsAllRegions() {
  const modelMap = new Map();

  const regionPromises = MANTLE_REGIONS.map(region => fetchMantleModelsForRegion(region));
  const results = await Promise.all(regionPromises);

  const mantleRegionCount = results.filter(r => r.models.length > 0).length;
  console.log(`Mantleが利用可能なリージョン数: ${mantleRegionCount} / ${MANTLE_REGIONS.length}`);

  for (const { region, models } of results) {
    for (const model of models) {
      const modelId = model.id;
      if (modelMap.has(modelId)) {
        modelMap.get(modelId).regions.push(region);
      } else {
        modelMap.set(modelId, {
          modelId,
          modelName: model.id, // Mantle APIはモデル名としてIDのみ返す
          providerName: extractProviderFromModelId(modelId),
          endpoint: 'bedrock-mantle',
          regions: [region],
          detectedAt: new Date().toISOString()
        });
      }
    }
  }

  return {
    models: Array.from(modelMap.values()),
    mantleRegionCount,
  };
}

/**
 * モデルIDからプロバイダー名を推定する
 * 例: "anthropic.claude-sonnet-4-6" → "Anthropic"
 *     "openai.gpt-oss-120b" → "OpenAI"
 *     "deepseek.deepseek-v3-2" → "DeepSeek"
 */
function extractProviderFromModelId(modelId) {
  const providerMap = {
    'anthropic': 'Anthropic',
    'openai': 'OpenAI',
    'meta': 'Meta',
    'deepseek': 'DeepSeek',
    'google': 'Google',
    'mistral': 'Mistral AI',
    'minimax': 'MiniMax',
    'moonshot': 'Moonshot AI',
    'nvidia': 'NVIDIA',
    'qwen': 'Qwen',
    'stability': 'Stability AI',
    'cohere': 'Cohere',
    'ai21': 'AI21 Labs',
    'amazon': 'Amazon',
    'twelvelabs': 'TwelveLabs',
    'writer': 'Writer',
    'xai': 'xAI',
    'z-ai': 'Z.AI',
  };

  const prefix = modelId.split('.')[0].toLowerCase();
  return providerMap[prefix] || prefix;
}

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
 * 新しいMantleモデルをDynamoDBに保存（mantle: プレフィックス付きで区別）
 */
async function saveNewMantleModels(models) {
  const promises = models.map(model =>
    dynamo.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        ...model,
        modelId: `mantle:${model.modelId}`, // DynamoDBキーにはプレフィックス付与
        originalModelId: model.modelId,
      }
    }))
  );
  await Promise.all(promises);
  console.log(`${models.length} 件の新Mantleモデルを DynamoDBに保存`);
}

/**
 * メール通知を送信（英語 → 日本語の順で記載）
 * ドキュメントリンク・コンソールリンク付き
 * Mantleモデル対応
 */
async function sendEmailNotification(newModels, newMantleModels, isStatusCheck, bedrockRegionCount, mantleRegionCount) {
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
Mantle Available Regions: ${mantleRegionCount}
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
Mantle利用可能リージョン数: ${mantleRegionCount}
新モデル: なし

システムは自動的にチェックを続けています。

📖 対応モデル一覧: ${BEDROCK_DOCS_URL}
💰 料金: ${BEDROCK_PRICING_URL}

---
Sent by Bedrock Model Monitor / Bedrock Model Monitorから自動送信
`;
  } else {
    const totalNewCount = newModels.length + newMantleModels.length;

    // 英語版 Foundation Models 一覧
    const modelListEn = newModels.map(model => {
      const regionLines = model.regions.map(r => `    - ${formatRegion(r)}`).join('\n');
      const firstRegion = model.regions[0];
      return `■ ${model.modelName} is now available in ${model.regions.length} region(s).
  Model ID: ${model.modelId}
  Provider: ${model.providerName}
  Endpoint: bedrock-runtime (ListFoundationModels)
  Input: ${model.inputModalities.join(', ')}
  Output: ${model.outputModalities.join(', ')}
  Streaming: ${model.responseStreamingSupported ? 'Yes' : 'No'}
  Console: ${getConsoleUrl(firstRegion)}
  Regions:
${regionLines}`;
    }).join('\n\n');

    // 英語版 Mantle Models 一覧
    const mantleListEn = newMantleModels.map(model => {
      const regionLines = model.regions.map(r => `    - ${formatRegion(r)}`).join('\n');
      const firstRegion = model.regions[0];
      return `■ [Mantle] ${model.modelId} is now available in ${model.regions.length} region(s).
  Model ID: ${model.modelId}
  Provider: ${model.providerName}
  Endpoint: bedrock-mantle (OpenAI-compatible)
  APIs: Responses API, Chat Completions, Messages API
  Console: ${getConsoleUrl(firstRegion)}
  Regions:
${regionLines}`;
    }).join('\n\n');

    // 日本語版 Foundation Models 一覧
    const modelListJa = newModels.map(model => {
      const regionLines = model.regions.map(r => `    - ${formatRegion(r)}`).join('\n');
      const firstRegion = model.regions[0];
      return `■ ${model.regions.length}個のリージョンで ${model.modelName} が使えるようになりました。
  モデルID: ${model.modelId}
  プロバイダー: ${model.providerName}
  エンドポイント: bedrock-runtime (ListFoundationModels)
  入力: ${model.inputModalities.join(', ')}
  出力: ${model.outputModalities.join(', ')}
  ストリーミング: ${model.responseStreamingSupported ? '対応' : '非対応'}
  コンソール: ${getConsoleUrl(firstRegion)}
  リージョン詳細:
${regionLines}`;
    }).join('\n\n');

    // 日本語版 Mantle Models 一覧
    const mantleListJa = newMantleModels.map(model => {
      const regionLines = model.regions.map(r => `    - ${formatRegion(r)}`).join('\n');
      const firstRegion = model.regions[0];
      return `■ [Mantle] ${model.regions.length}個のリージョンで ${model.modelId} が使えるようになりました。
  モデルID: ${model.modelId}
  プロバイダー: ${model.providerName}
  エンドポイント: bedrock-mantle (OpenAI互換)
  API: Responses API, Chat Completions, Messages API
  コンソール: ${getConsoleUrl(firstRegion)}
  リージョン詳細:
${regionLines}`;
    }).join('\n\n');

    // 英語セクション構築
    let englishSection = `[English]
New generative AI model(s) have been released on Amazon Bedrock!

Detection Time: ${timeEn} (UTC)
New Models: ${totalNewCount} (Foundation: ${newModels.length}, Mantle: ${newMantleModels.length})
Bedrock Available Regions: ${bedrockRegionCount}
Mantle Available Regions: ${mantleRegionCount}
`;

    if (newModels.length > 0) {
      englishSection += `
--- New Foundation Models (bedrock-runtime) ---

${modelListEn}
`;
    }

    if (newMantleModels.length > 0) {
      englishSection += `
--- New Mantle Models (bedrock-mantle) ---

${mantleListEn}
`;
    }

    englishSection += `
📖 Full Model List: ${BEDROCK_DOCS_URL}
📖 Mantle Docs: https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html
💰 Pricing: ${BEDROCK_PRICING_URL}`;

    // 日本語セクション構築
    let japaneseSection = `[日本語]
Amazon Bedrockに新しい生成AIモデルがリリースされました！

検出日時: ${timeJa} (JST)
新モデル数: ${totalNewCount}（Foundation: ${newModels.length}, Mantle: ${newMantleModels.length}）
Bedrock利用可能リージョン数: ${bedrockRegionCount}
Mantle利用可能リージョン数: ${mantleRegionCount}
`;

    if (newModels.length > 0) {
      japaneseSection += `
--- 新Foundationモデル (bedrock-runtime) ---

${modelListJa}
`;
    }

    if (newMantleModels.length > 0) {
      japaneseSection += `
--- 新Mantleモデル (bedrock-mantle) ---

${mantleListJa}
`;
    }

    japaneseSection += `
📖 対応モデル一覧: ${BEDROCK_DOCS_URL}
📖 Mantleドキュメント: https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html
💰 料金: ${BEDROCK_PRICING_URL}`;

    subject = `🎉 ${totalNewCount} New Bedrock Model(s) Detected / Bedrock新モデル${totalNewCount}件検出`;
    emailBody = `${englishSection}

---

${japaneseSection}

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
 * Mantleモデル対応
 */
async function publishToSns(newModels, newMantleModels, bedrockRegionCount, mantleRegionCount) {
  if (!SNS_TOPIC_ARN) {
    console.log('SNS_TOPIC_ARNが未設定のためSNS通知をスキップ');
    return;
  }

  const totalNewCount = newModels.length + newMantleModels.length;

  const payload = {
    source: 'bedrock-model-monitor',
    detectedAt: new Date().toISOString(),
    bedrockRegionCount,
    mantleRegionCount,
    newModelCount: totalNewCount,
    newFoundationModelCount: newModels.length,
    newMantleModelCount: newMantleModels.length,
    models: newModels.map(model => ({
      modelId: model.modelId,
      modelName: model.modelName,
      providerName: model.providerName,
      endpoint: 'bedrock-runtime',
      regionCount: model.regions.length,
      regions: model.regions,
      inputModalities: model.inputModalities,
      outputModalities: model.outputModalities,
      streaming: model.responseStreamingSupported,
      docsUrl: BEDROCK_DOCS_URL,
      consoleUrl: getConsoleUrl(model.regions[0])
    })),
    mantleModels: newMantleModels.map(model => ({
      modelId: model.modelId,
      providerName: model.providerName,
      endpoint: 'bedrock-mantle',
      regionCount: model.regions.length,
      regions: model.regions,
      apis: ['Responses API', 'Chat Completions', 'Messages API'],
      docsUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html',
      consoleUrl: getConsoleUrl(model.regions[0])
    })),
    // Slack/Teams向けのサマリーテキスト
    summary: [
      ...newModels.map(m =>
        `🆕 ${m.modelName} (${m.providerName}) [bedrock-runtime] - ${m.regions.length} region(s): ${m.regions.join(', ')}`
      ),
      ...newMantleModels.map(m =>
        `🆕 ${m.modelId} (${m.providerName}) [bedrock-mantle] - ${m.regions.length} region(s): ${m.regions.join(', ')}`
      )
    ].join('\n')
  };

  const command = new PublishCommand({
    TopicArn: SNS_TOPIC_ARN,
    Subject: `Bedrock New Model(s): ${totalNewCount} detected (Foundation: ${newModels.length}, Mantle: ${newMantleModels.length})`,
    Message: JSON.stringify(payload, null, 2)
  });

  await sns.send(command);
  console.log('SNS通知を送信しました');
}
