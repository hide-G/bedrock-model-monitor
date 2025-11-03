#!/bin/bash

# Bedrock Model Monitor Deploy Script

echo "=== Bedrock Model Monitor Deploy ==="

# Prompt for email address
read -p "Enter your email address for notifications: " EMAIL_ADDRESS

if [ -z "$EMAIL_ADDRESS" ]; then
    echo "Error: Email address is required"
    exit 1
fi

# Validate email format
if ! [[ "$EMAIL_ADDRESS" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
    echo "Error: Invalid email format"
    exit 1
fi

echo ""
echo "Email address: $EMAIL_ADDRESS"

# Check SES email verification
echo "Checking SES email verification..."
EMAIL_STATUS=$(aws ses get-identity-verification-attributes --identities "$EMAIL_ADDRESS" --query "VerificationAttributes.\"$EMAIL_ADDRESS\".VerificationStatus" --output text 2>/dev/null)

if [ "$EMAIL_STATUS" != "Success" ]; then
    echo "Email not verified. Sending verification email..."
    aws ses verify-email-identity --email-address "$EMAIL_ADDRESS"
    echo "Verification email sent to $EMAIL_ADDRESS"
    echo "Please check your inbox and click the verification link"
    echo "Then run this script again"
    exit 1
fi

echo "Email verified"

# Install Lambda dependencies
echo ""
echo "Installing Lambda dependencies..."
cd lambda
npm install
cd ..

# SAM Build
echo ""
echo "Running SAM build..."
sam build

if [ $? -ne 0 ]; then
    echo "Build failed"
    exit 1
fi

# SAM Deploy
echo ""
echo "Running SAM deploy..."
sam deploy --stack-name bedrock-model-monitor --capabilities CAPABILITY_IAM --resolve-s3 --parameter-overrides EmailAddress="$EMAIL_ADDRESS"

if [ $? -ne 0 ]; then
    echo "Deploy failed"
    exit 1
fi

echo ""
echo "Deploy completed!"
echo "The system will check Bedrock models every 10 minutes"
echo "Check logs: aws logs tail /aws/lambda/bedrock-model-monitor-MonitorFunction --follow"
