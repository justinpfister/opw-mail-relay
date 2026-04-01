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

This is the recommended approach — no credentials or config files stored on disk. The relay pulls SMTP config from SSM Parameter Store and uses the instance profile for SES access.

### 3. SSM parameters

Create the SMTP config in Parameter Store:

```bash
aws ssm put-parameter --name /opw-mail-relay/SMTP_USER --value "your-username" --type String
aws ssm put-parameter --name /opw-mail-relay/SMTP_PASS --value "your-password" --type SecureString
aws ssm put-parameter --name /opw-mail-relay/SMTP_PORT --value "2525" --type String
aws ssm put-parameter --name /opw-mail-relay/AWS_REGION --value "us-east-1" --type String
```

### 4. Security group

Open port 2525 inbound, restricted to the OPW device's IP address.

### 5. Install and run

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

The code works the same, but you need to provide AWS credentials and SMTP config manually since there's no instance profile or SSM.

**SMTP config** — Set environment variables in `ecosystem.config.js`:

```js
env: {
  SMTP_USER: "your-username",
  SMTP_PASS: "your-password",
  SMTP_PORT: 2525,
  AWS_REGION: "us-east-1",
}
```

**AWS credentials** — Provide SES access via one of:

- Environment variables: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in the `env` block above
- AWS credentials file: `~/.aws/credentials`

Create an IAM user with the `ses:SendRawEmail` policy and use its access keys.

## Config

Configuration is loaded in this order:

1. **AWS SSM Parameter Store** (recommended for EC2) — parameters under `/opw-mail-relay/`:
   - `/opw-mail-relay/SMTP_PORT` — port to listen on (String, default: 2525)
   - `/opw-mail-relay/SMTP_USER` — auth username for OPW device (String)
   - `/opw-mail-relay/SMTP_PASS` — auth password for OPW device (SecureString)
   - `/opw-mail-relay/AWS_REGION` — SES region (String, default: us-east-1)

2. **Environment variables** (fallback) — same names without the path prefix:
   - `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `AWS_REGION`
   - Set these in `ecosystem.config.js`, your shell, systemd unit, etc.

`SMTP_USER` and `SMTP_PASS` are required. If neither SSM nor env vars provide them, the server exits with an error.

## OPW device settings

| Setting | Value |
|---|---|
| Server name | `<your-server-hostname>` (or EC2 IP) |
| Port | `2525` |
| User | value of `SMTP_USER` |
| Password | value of `SMTP_PASS` |
| Email | any address at your SES-verified domain |
| SMTP Server Authentication | checked |

