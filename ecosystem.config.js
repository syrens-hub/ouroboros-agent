/* global module, __dirname */
module.exports = {
  apps: [
    {
      name: "ouroboros-agent",
      script: "npm",
      args: "run web:start",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "./.ouroboros/logs/err.log",
      out_file: "./.ouroboros/logs/out.log",
      merge_logs: true,
    },
  ],
};
