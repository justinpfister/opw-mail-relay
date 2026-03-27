module.exports = {
  apps: [
    {
      name: "opw-mail-relay",
      script: "server.js",
      env: {
        SMTP_PORT: 2525,
        SMTP_USER: "halltrask",
        SMTP_PASS: "Abc123##",
        AWS_REGION: "us-east-1",
      },
    },
  ],
};
