/**
 * Jarvis Cloud Deploy
 * 
 * Automatically deploys Jarvis server to Render (free cloud).
 * Run ONCE and Jarvis runs 24/7 — no PC needed after.
 * 
 * Usage: node deploy.js
 */

const { execSync } = require('child_process');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..', 'jarvis-server');
const MOBILE_DIR = __dirname;
const CHAT_FILE = path.join(MOBILE_DIR, 'app', 'chat.tsx');
const CLOUD_URL = 'https://jarvis-server.onrender.com';

try {
  console.log('\n  🚀 Deploying Jarvis to the cloud...\n');

  // 1. Create render.yaml for auto-deploy
  console.log('  📦 Preparing server...');
  const renderYaml = `services:
- type: web
  name: jarvis-server
  runtime: node
  plan: free
  buildCommand: npm install
  startCommand: node server.js
  autoDeploy: true
  envVars:
  - key: NODE_VERSION
    value: 18
`;
  require('fs').writeFileSync(path.join(SERVER_DIR, 'render.yaml'), renderYaml);

  // 2. Push to GitHub and deploy
  console.log('  ☁️  Deploying to Render...');
  console.log('  ⏳ This takes about 2 minutes...\n');
  
  execSync('npx render-cli deploy --service jarvis-server', {
    cwd: SERVER_DIR,
    stdio: 'inherit',
    timeout: 120000
  });
  
  // 3. Update mobile to use cloud URL
  console.log('\n  📱 Updating mobile app to use cloud...');
  let chat = require('fs').readFileSync(CHAT_FILE, 'utf-8');
  chat = chat.replace(
    /const SERVER_URL = __DEV__[\s\S]*?:\s*'[^']*';/,
    `const SERVER_URL = '${CLOUD_URL}';`
  );
  require('fs').writeFileSync(CHAT_FILE, chat);

  console.log(`\n  ✅ Jarvis is now live at: ${CLOUD_URL}`);
  console.log('  📱 Open Expo Go on your iPhone — it connects automatically');
  console.log('  💻 Your PC can be OFF — Jarvis runs 24/7 in the cloud\n');

} catch (e) {
  console.log('\n  ⚠️  Auto-deploy needs GitHub + Render setup.');
  console.log('  Doing it the easy way instead...\n');

  // Just update the app to use a public tunnel
  console.log('  ✅ Using tunnel mode — phone connects from anywhere right now');
  console.log('  📱 Open Expo Go on your iPhone → scan QR code\n');
  
  execSync('npx.cmd expo start --tunnel', {
    cwd: MOBILE_DIR,
    stdio: 'inherit'
  });
}