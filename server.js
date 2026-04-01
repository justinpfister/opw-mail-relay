const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const { SESClient, SendRawEmailCommand } = require("@aws-sdk/client-ses");
const { SSMClient, GetParametersByPathCommand } = require("@aws-sdk/client-ssm");

// --- Configuration ---
async function loadConfig() {
  // Try AWS SSM Parameter Store first
  try {
    const ssm = new SSMClient({ region: process.env.AWS_REGION || "us-east-1" });
    const response = await ssm.send(
      new GetParametersByPathCommand({
        Path: "/opw-mail-relay/",
        WithDecryption: true,
      })
    );

    const params = {};
    for (const param of response.Parameters || []) {
      params[param.Name.split("/").pop()] = param.Value;
    }

    if (params.SMTP_USER && params.SMTP_PASS) {
      console.log("[CONFIG] Loaded from AWS SSM Parameter Store");
      return {
        port: parseInt(params.SMTP_PORT) || 2525,
        smtpUser: params.SMTP_USER,
        smtpPass: params.SMTP_PASS,
        awsRegion: params.AWS_REGION || "us-east-1",
      };
    }
  } catch (err) {
    console.log("[CONFIG] SSM not available, falling back to environment variables");
  }

  // Fall back to environment variables
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error("[CONFIG] SMTP_USER and SMTP_PASS must be set via SSM Parameter Store or environment variables");
    process.exit(1);
  }

  console.log("[CONFIG] Loaded from environment variables");
  return {
    port: parseInt(process.env.SMTP_PORT) || 2525,
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    awsRegion: process.env.AWS_REGION || "us-east-1",
  };
}

async function main() {
const config = await loadConfig();
const ses = new SESClient({ region: config.awsRegion });

const server = new SMTPServer({
  // Listen on all interfaces
  // Allow older TLS for embedded devices like OPW
  secure: false,
  disabledCommands: ["STARTTLS"],
  authOptional: false,
  allowInsecureAuth: true,
  hideSTARTTLS: true,
  size: 52428800,
  logger: true,

  // Authentication handler
  onAuth(auth, session, callback) {
    console.log(`[AUTH] Attempt from ${session.remoteAddress} | method: ${auth.method} | user: ${auth.username}`);
    if (auth.username === config.smtpUser && auth.password === config.smtpPass) {
      console.log(`[AUTH] Success from ${session.remoteAddress}`);
      return callback(null, { user: auth.username });
    }
    console.log(`[AUTH] Failed from ${session.remoteAddress}`);
    return callback(new Error("Invalid credentials"));
  },

  // Handle incoming mail
  onData(stream, session, callback) {
    const chunks = [];

    stream.on("data", (chunk) => chunks.push(chunk));

    stream.on("end", async () => {
      let rawEmail = Buffer.concat(chunks);

      // Strip duplicate headers that SES rejects (e.g. OPW sends MIME-Version twice)
      const emailStr = rawEmail.toString();
      const headerEnd = emailStr.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        const headerSection = emailStr.substring(0, headerEnd);
        const body = emailStr.substring(headerEnd);
        const seen = new Set();
        const dedupedHeaders = headerSection.split("\r\n").filter((line) => {
          const key = line.split(":")[0].toLowerCase();
          if (seen.has(key)) {
            console.log(`[FIX] Removed duplicate header: ${key}`);
            return false;
          }
          seen.add(key);
          return true;
        });
        rawEmail = Buffer.from(dedupedHeaders.join("\r\n") + body);
      }

      try {
        const parsed = await simpleParser(rawEmail);
        const from = parsed.from?.text || "unknown";
        const to = parsed.to?.text || "unknown";
        const subject = parsed.subject || "(no subject)";

        console.log(`[MAIL] From: ${from} | To: ${to} | Subject: ${subject}`);

        const command = new SendRawEmailCommand({
          RawMessage: { Data: rawEmail },
        });

        await ses.send(command);
        console.log(`[MAIL] Relayed successfully`);
        callback();
      } catch (err) {
        console.error(`[ERROR] Failed to relay: ${err.message}`);
        callback(new Error("Failed to relay message"));
      }
    });
  },

  // Log connections
  onConnect(session, callback) {
    console.log(`[CONN] Connection from ${session.remoteAddress}`);
    callback();
  },
});

server.listen(config.port, () => {
  console.log(`[RELAY] SMTP relay listening on port ${config.port}`);
  console.log(`[RELAY] Auth user: ${config.smtpUser}`);
  console.log(`[RELAY] Relaying via SES (${config.awsRegion})`);
});

server.on("error", (err) => {
  console.error(`[ERROR] Server error: ${err.message}`);
});
}

main();
