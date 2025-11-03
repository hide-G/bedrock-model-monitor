const { BedrockClient, ListFoundationModelsCommand } = require('@aws-sdk/client-bedrock');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const bedrock = new BedrockClient({});
const dynamoClient = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(dynamoClient);
const ses = new SESClient({});

const TABLE_NAME = process.env.TABLE_NAME;
const EMAIL_ADDRESS = process.env.EMAIL_ADDRESS;

exports.handler = async (event) => {
  console.log('Bedrock Model Monitor started');
  console.log('Event:', JSON.stringify(event));
  
  // Check if this is a manual test invocation
  const isManualTest = !event.source || event.source !== 'aws.events';
  
  try {
    // 1. Bedrockから現在利用可能なモデル一覧を取得
    const currentModels = await fetchBedrockModels();
    console.log(`Found ${currentModels.length} models in Bedrock`);
    
    // 2. DynamoDBから既知のモデル一覧を取得
    const knownModels = await fetchKnownModels();
    console.log(`Found ${knownModels.size} known models in DynamoDB`);
    
    // 3. 新しいモデルを検出
    const newModels = currentModels.filter(model => !knownModels.has(model.modelId));
    
    if (newModels.length > 0) {
      console.log(`🎉 Detected ${newModels.length} new model(s)!`);
      
      // 4. 新モデルをDynamoDBに保存
      await saveNewModels(newModels);
      
      // 5. メール通知を送信
      await sendEmailNotification(newModels, false);
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: `Detected ${newModels.length} new model(s)`,
          newModels: newModels.map(m => m.modelId)
        })
      };
    } else {
      console.log('No new models detected');
      
      // Manual test: send notification even if no new models
      if (isManualTest) {
        console.log('Manual test detected - sending status email');
        await sendEmailNotification([], true);
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            message: 'No new models - status email sent (manual test)',
            totalModels: currentModels.length
          })
        };
      }
      
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No new models' })
      };
    }
    
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};

async function fetchBedrockModels() {
  const command = new ListFoundationModelsCommand({});
  const response = await bedrock.send(command);
  
  return response.modelSummaries.map(model => ({
    modelId: model.modelId,
    modelName: model.modelName,
    providerName: model.providerName,
    inputModalities: model.inputModalities,
    outputModalities: model.outputModalities,
    responseStreamingSupported: model.responseStreamingSupported,
    customizationsSupported: model.customizationsSupported,
    inferenceTypesSupported: model.inferenceTypesSupported,
    detectedAt: new Date().toISOString()
  }));
}

async function fetchKnownModels() {
  const command = new ScanCommand({
    TableName: TABLE_NAME,
    ProjectionExpression: 'modelId'
  });
  
  const response = await dynamo.send(command);
  return new Set(response.Items.map(item => item.modelId));
}

async function saveNewModels(models) {
  const promises = models.map(model => 
    dynamo.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: model
    }))
  );
  
  await Promise.all(promises);
  console.log(`Saved ${models.length} new model(s) to DynamoDB`);
}

async function sendEmailNotification(newModels, isStatusCheck) {
  let subject, emailBody;
  
  if (isStatusCheck) {
    // Status check email (no new models)
    subject = '✅ Bedrock Model Monitor - 動作確認';
    emailBody = `
Bedrock Model Monitorは正常に動作しています。

確認日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
ステータス: 正常
新モデル: なし

現在、新しいモデルの追加はありません。
システムは10分毎に自動的にチェックを続けています。

---
このメールはBedrock Model Monitorから自動送信されています。
手動テスト実行時のみ、新モデルがない場合でもこのメールが送信されます。
`;
  } else {
    // New models detected
    const modelList = newModels.map(model => 
      `- ${model.modelName} (${model.modelId})
  Provider: ${model.providerName}
  Input: ${model.inputModalities.join(', ')}
  Output: ${model.outputModalities.join(', ')}
  Streaming: ${model.responseStreamingSupported ? 'Yes' : 'No'}`
    ).join('\n\n');
    
    subject = `🎉 Bedrock新モデル検出: ${newModels.length}件`;
    emailBody = `
Amazon Bedrockに新しいモデルがリリースされました！

検出日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
新モデル数: ${newModels.length}

【新モデル一覧】
${modelList}

---
このメールはBedrock Model Monitorから自動送信されています。
`;
  }

  const command = new SendEmailCommand({
    Source: EMAIL_ADDRESS,
    Destination: {
      ToAddresses: [EMAIL_ADDRESS]
    },
    Message: {
      Subject: {
        Data: subject,
        Charset: 'UTF-8'
      },
      Body: {
        Text: {
          Data: emailBody,
          Charset: 'UTF-8'
        }
      }
    }
  });
  
  await ses.send(command);
  console.log('Email notification sent');
}
