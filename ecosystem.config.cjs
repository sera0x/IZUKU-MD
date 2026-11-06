module.exports = {
  apps : [{
    name: 'IZUKU-MD',
    script: 'dist/src/index.js',
    env: {
      PORT: 3000
    },
    env_production: {
      PORT: 3000,
      NODE_ENV: 'production'
    }
  }]
}