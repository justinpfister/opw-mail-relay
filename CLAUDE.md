# OPW Mail Relay

SMTP relay server for OPW fuel management devices. Accepts SMTP connections on port 2525 with simple username/password authentication and relays mail through AWS SES.

## Architecture

OPW Device → This relay (port 2525, plain SMTP + auth) → AWS SES → Recipient

## Why this exists

OPW fuel management systems have limited SMTP clients (old TLS, basic auth). AWS SES requires TLS 1.2+ and uses IAM-derived credentials, which these devices can't handle. This relay bridges the gap.

## Setup requirements

Before this works, you need:
1. **SES**: Verify the sending domain (techmaid.com) in AWS SES
2. **SES**: Request production access (out of sandbox) if sending to unverified addresses
3. **IAM**: EC2 instance needs an IAM role with `ses:SendRawEmail` permission
4. **Security Group**: Open port 2525 (restrict to OPW device IPs if possible)
5. **npm install** on the EC2 server

## Running

```bash
pm2 start ecosystem.config.js
```

## Config

Environment variables (set in ecosystem.config.js):
- `SMTP_PORT` - port to listen on (default: 2525)
- `SMTP_USER` - auth username
- `SMTP_PASS` - auth password
- `AWS_REGION` - SES region (default: us-east-1)

## Sending domain

Sends as: prescott@hall-trask.com (or whatever the OPW device is configured to use)
SES verified domain: techmaid.com
