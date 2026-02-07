// SESメール検証用カスタムリソースハンドラー
const { SESClient, VerifyEmailIdentityCommand, DeleteIdentityCommand } = require('@aws-sdk/client-ses');
const ses = new SESClient({});

exports.handler = async (event) => {
  console.log('SES検証カスタムリソース:', JSON.stringify(event));

  const email = event.ResourceProperties.EmailAddress;
  const requestType = event.RequestType;

  try {
    if (requestType === 'Create' || requestType === 'Update') {
      // SES検証メールを送信
      await ses.send(new VerifyEmailIdentityCommand({ EmailAddress: email }));
      console.log(`検証メールを ${email} に送信しました`);
    } else if (requestType === 'Delete') {
      // スタック削除時はSES IDを削除（任意）
      try {
        await ses.send(new DeleteIdentityCommand({ Identity: email }));
        console.log(`SES ID ${email} を削除しました`);
      } catch (e) {
        console.log('SES ID削除をスキップ:', e.message);
      }
    }

    await sendResponse(event, 'SUCCESS', { Message: `SES verification email sent to ${email}` });
  } catch (error) {
    console.error('エラー:', error);
    await sendResponse(event, 'FAILED', { Error: error.message });
  }
};

// CloudFormationカスタムリソースのレスポンス送信
async function sendResponse(event, status, data) {
  const body = JSON.stringify({
    Status: status,
    Reason: data.Error || 'See CloudWatch Logs',
    PhysicalResourceId: event.LogicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data
  });

  const url = new URL(event.ResponseURL);
  const options = {
    method: 'PUT',
    headers: { 'Content-Type': '', 'Content-Length': Buffer.byteLength(body) }
  };

  return new Promise((resolve, reject) => {
    const https = require('https');
    const req = https.request(url, options, (res) => {
      console.log(`CloudFormationレスポンス送信: ${res.statusCode}`);
      resolve();
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
