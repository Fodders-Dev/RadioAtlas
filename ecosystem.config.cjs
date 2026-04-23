const { join } = require('node:path');

module.exports = {
  apps: [
    {
      name: 'radioatlas-api',
      cwd: join(__dirname, 'apps/api'),
      script: 'dist/index.js',
      interpreter: 'node',
      exp_backoff_restart_delay: 2000,
      kill_timeout: 5000,
      listen_timeout: 10000,
      max_memory_restart: '512M',
      min_uptime: '10s',
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    },
    {
      name: 'radioatlas-bot',
      cwd: join(__dirname, 'apps/bot'),
      script: 'dist/index.js',
      interpreter: 'node',
      exp_backoff_restart_delay: 2000,
      kill_timeout: 5000,
      min_uptime: '10s',
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
