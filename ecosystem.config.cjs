module.exports = {
  apps: [
    {
      name: 'radioatlas-api',
      cwd: __dirname,
      script: 'npm',
      args: '--workspace apps/api run start',
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
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
