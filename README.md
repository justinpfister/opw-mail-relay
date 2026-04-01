# OPW Mail Relay

**SMTP relay server for OPW Fuel Management Systems (SiteSentinel, Petro Vend, FSC3000, and other OPW/Dover controllers running Windows CE)**

If you've ever tried to get email alerts working from an OPW tank monitor to a modern mail provider — and watched it silently fail — this project is for you.

```
OPW Device ──plain SMTP──▸ This Relay ──TLS 1.2──▸ AWS SES ──▸ Recipient
               port 2525        (auth + quirk fixes)
```

## The Problem

OPW fuel management controllers (SiteSentinel iSite, Petro Vend, FSC3000, etc.) have built-in email alerting for inventory reports, tank alarms, and leak detection events. But their SMTP client is limited:

- **No TLS** — The embedded Windows CE mail client only speaks plain, unencrypted SMTP
- **No modern auth** — Just basic username/password, no OAuth, no IAM, no API keys
- **Protocol quirks** — Sends duplicate MIME headers, requires `SIZE` in EHLO, and other non-standard behavior

Meanwhile, every modern email provider (Gmail, Office 365, AWS SES) requires TLS 1.2+ at minimum. You can't point the OPW device at them directly. It connects, fails the TLS handshake, and gives up silently. No error, no log, just... no emails.

We found this out the hard way.

## The Solution

This relay sits between the OPW device and AWS SES. It speaks "old SMTP" on one side and "modern SMTP with TLS" on the other:

- Accepts plain SMTP connections with basic username/password auth
- Handles OPW-specific protocol quirks automatically (see below)
- Forwards mail through AWS SES with full TLS and IAM authentication
- Runs on a single small EC2 instance (t2.micro is plenty)

### OPW quirks this relay handles

| Quirk | What happens without the fix | How the relay handles it |
|---|---|---|
| **Requires `SIZE` in EHLO** | Device connects, sees no `SIZE` capability, immediately sends `QUIT` without authenticating | Relay advertises `SIZE 52428800` in EHLO response |
| **Sends duplicate `MIME-Version` headers** | AWS SES strictly rejects the message: `Duplicate header 'MIME-Version'` | Relay strips duplicate headers before forwarding |
| **No TLS support** | Device can't negotiate TLS, connection fails silently | Relay accepts plain SMTP and hides `STARTTLS` from EHLO so the device doesn't attempt it |

If you're fighting with OPW email alerts and seeing any of these symptoms — devices connecting then immediately disconnecting, SES rejecting messages, or emails just never arriving — this relay fixes all of it.

## Quick Start (EC2)

### 1. Verify your sending domain in SES

The relay sends mail as whatever "from" address the OPW device uses. That domain needs to be verified in AWS SES (us-east-1). This means adding a TXT record and 3 CNAME records for DKIM.

### 2. Create an IAM role for the EC2 instance

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendRawEmail",
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "ssm:GetParametersByPath",
      "Resource": "arn:aws:ssm:*:*:parameter/opw-mail-relay/*"
    }
  ]
}
```

### 3. Store your SMTP credentials in SSM Parameter Store

```bash
aws ssm put-parameter --name /opw-mail-relay/SMTP_USER --value "your-username" --type String
aws ssm put-parameter --name /opw-mail-relay/SMTP_PASS --value "your-password" --type SecureString
aws ssm put-parameter --name /opw-mail-relay/SMTP_PORT --value "2525" --type String
aws ssm put-parameter --name /opw-mail-relay/AWS_REGION --value "us-east-1" --type String
```

These are the credentials the OPW device will use to authenticate with the relay (not AWS credentials — those come from the IAM role automatically).

### 4. Lock down the security group

Open port 2525 inbound, restricted to the OPW device's IP address. This relay accepts unencrypted connections by design, so network-level restriction is important.

### 5. Deploy

```bash
git clone https://github.com/justinpfister/opw-mail-relay.git
cd opw-mail-relay
npm install
pm2 start ecosystem.config.js
pm2 save
```

Make pm2 survive reboots:

```bash
pm2 startup systemd
# Run the sudo command it outputs
pm2 save
```

### 6. Point the OPW device at the relay

| OPW Setting | Value |
|---|---|
| SMTP Server | Your EC2 hostname or IP |
| Port | `2525` |
| User | The `SMTP_USER` you stored in SSM |
| Password | The `SMTP_PASS` you stored in SSM |
| From Address | Any address at your SES-verified domain |
| SMTP Authentication | Enabled |

## Running Outside AWS

The relay works on any server — it's just Node.js. Without an EC2 instance profile, provide config via environment variables instead of SSM:

```js
// ecosystem.config.js
module.exports = {
  apps: [{
    name: "opw-mail-relay",
    script: "server.js",
    env: {
      SMTP_USER: "your-username",
      SMTP_PASS: "your-password",
      SMTP_PORT: 2525,
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "AKIA...",
      AWS_SECRET_ACCESS_KEY: "your-secret-key",
    },
  }],
};
```

Create an IAM user with `ses:SendRawEmail` permission and use its access keys.

## Configuration

Config is loaded in priority order:

1. **AWS SSM Parameter Store** — parameters under `/opw-mail-relay/` (recommended for EC2)
2. **Environment variables** — `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT`, `AWS_REGION`

| Variable | Required | Default | Description |
|---|---|---|---|
| `SMTP_USER` | Yes | — | Username the OPW device authenticates with |
| `SMTP_PASS` | Yes | — | Password the OPW device authenticates with |
| `SMTP_PORT` | No | `2525` | Port the relay listens on |
| `AWS_REGION` | No | `us-east-1` | AWS region for SES |

## How It Works

The relay is a single `server.js` file (~100 lines). It uses:

- [`smtp-server`](https://nodemailer.com/extras/smtp-server/) — SMTP server implementation
- [`mailparser`](https://nodemailer.com/extras/mailparser/) — Email parsing for logging
- [`@aws-sdk/client-ses`](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ses/) — SES integration
- [`@aws-sdk/client-ssm`](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ssm/) — Config from Parameter Store

On startup, it loads config from SSM (falling back to env vars), starts an SMTP server, and for each incoming message: authenticates the sender, deduplicates any malformed headers, and forwards the raw email to SES.

## License

MIT
