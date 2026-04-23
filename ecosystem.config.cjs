module.exports = {
  apps: [
    {
      name: 'radioatlas-api',
      cwd: __dirname,
      script: 'npm',
      args: '--workspace apps/api run start',
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
      cwd: __dirname,
      script: 'npm',
      args: '--workspace apps/bot run start',
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
