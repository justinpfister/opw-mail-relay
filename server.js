const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const { SESClient, SendRawEmailCommand } = require("@aws-sdk/client-ses");

// --- Configuration ---
const config = {
  port: process.env.SMTP_PORT || 2525,
  smtpUser: process.env.SMTP_USER || "halltrask",
  smtpPass: process.env.SMTP_PASS || "Abc123##",
  awsRegion: process.env.AWS_REGION || "us-east-1",
};

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
      const rawEmail = Buffer.concat(chunks);

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
