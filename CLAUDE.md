# OPW Mail Relay

SMTP relay server for OPW fuel management devices. Accepts SMTP connections on port 2525 with simple username/password authentication and relays mail through AWS SES.

## Architecture

```
OPW Device → This relay (port 2525, plain SMTP + auth) → AWS SES → Recipient
```

## Why this exists

OPW fuel management systems are industrial tank monitors running Windows CE. They have built-in email alerts (inventory reports, alarms) but their SMTP client is ancient — it only speaks plain unencrypted SMTP with basic username/password auth.

AWS SES requires TLS 1.2+ and uses IAM credentials, which these devices can't do. We tried connecting the OPW device directly to SES and it failed. This relay sits in between: it speaks "old SMTP" to the device and "modern SMTP" to SES.

### OPW device quirks this relay handles

- **Requires `SIZE` in EHLO response** — Without it, the device connects then immediately quits without authenticating.
- **Sends duplicate `MIME-Version` headers** — SES strictly rejects these, so the relay strips duplicates before forwarding.
- **No TLS support** — The relay runs plain SMTP with `STARTTLS` hidden from the EHLO response.

## Setup on EC2 (recommended)

### 1. SES domain verification

Verify your sending domain in AWS SES (us-east-1). This includes a TXT record for domain verification and 3 CNAME records for DKIM. The relay sends emails as whatever "from" address the OPW device is configured with, so that domain must be verified.

### 2. IAM instance profile

Attach an IAM role to the EC2 instance with this policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "ses:SendRawEmail",
    "Resource": "*"
  }]
}
```

This is the recommended approach — no credentials stored on disk. The AWS SDK automatically picks up temporary credentials from the instance profile.

### 3. Security group

Open port 2525 inbound, restricted to the OPW device's IP address.

### 4. Install and run

```bash
git clone <this repo>
cd opw-mail-relay
npm install
pm2 start ecosystem.config.js
pm2 save
```

To make pm2 survive reboots:

```bash
pm2 startup systemd
# Run the sudo command it outputs
pm2 save
```

## Setup on a non-AWS server

The code works the same, but you need to provide AWS credentials manually since there's no instance profile.

**Option A** — Environment variables in `ecosystem.config.js`:

```js
env: {
  AWS_ACCESS_KEY_ID: "AKIA...",
  AWS_SECRET_ACCESS_KEY: "your-secret-key",
  AWS_REGION: "us-east-1",
  // ... other config
}
```

**Option B** — AWS credentials file (`~/.aws/credentials`):

```ini
[default]
aws_access_key_id = AKIA...
aws_secret_access_key = your-secret-key
```

Create an IAM user with the `ses:SendRawEmail` policy and use its access keys.

## Config

Environment variables (set in `ecosystem.config.js`):

- `SMTP_PORT` - port to listen on (default: 2525)
- `SMTP_USER` - auth username for OPW device
- `SMTP_PASS` - auth password for OPW device
- `AWS_REGION` - SES region (default: us-east-1)

## OPW device settings

| Setting | Value |
|---|---|
| Server name | `opwsmtp.techmaid.com` (or EC2 IP) |
| Port | `2525` |
| User | value of `SMTP_USER` |
| Password | value of `SMTP_PASS` |
| Email | any address at your SES-verified domain |
| SMTP Server Authentication | checked |

## Current deployment

- **EC2 instance**: `i-0e3981433ab678f70` (`54.145.148.62`)
- **DNS**: `opwsmtp.techmaid.com`
- **SES verified domains**: `techmaid.com`, `prescottoil.com`
- **IAM role**: `EC2-SES-SendEmail`
- **OPW device IP**: `173.14.158.221`
