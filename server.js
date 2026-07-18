/**
 * Jarvis Cloud Server
 * 
 * Runs the Jarvis AI engine 24/7 on free cloud hosting.
 * Desktop and mobile both connect to the same instance.
 * Shared memory, shared skills — everyone talks to the same Jarvis.
 * 
 * Deploy to: Railway, Render, Fly.io, or any Node.js host
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import multer from 'multer';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Jarvis Core Engine ──────────────────────────────────────
import { JarvisAI, MemorySystem, SkillEngine, SecurityGate } from './jarvis-core/index.js';

// ── File-based memory (persists on the server) ──────────────
const MEMORY_FILE = path.join(__dirname, 'data', 'jarvis-memory.json');

class ServerSyncAdapter {
  constructor() {
    this.data = null;
  }
  async load() {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        const content = fs.readFileSync(MEMORY_FILE, 'utf-8');
        this.data = JSON.parse(content);
        return this.data;
      }
    } catch (e) {
      console.warn('Memory load failed:', e.message);
    }
    return null;
  }
  async save(snapshot) {
    try {
      const dir = path.dirname(MEMORY_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(snapshot, null, 2));
    } catch (e) {
      console.warn('Memory save failed:', e.message);
    }
  }
}

// ── Initialize Jarvis ───────────────────────────────────────
let jarvis = null;
let security = null;

async function initJarvis() {
  const memory = new MemorySystem({ syncAdapter: new ServerSyncAdapter() });
  const skills = new SkillEngine();
  security = new SecurityGate({ sessionExpiry: 30 * 60 * 1000 }); // 30 min

  jarvis = new JarvisAI({
    memory,
    skillEngine: skills,
    name: 'Jarvis',
    userName: 'You',
    platform: 'cloud',
    openrouterKey: process.env.OPENROUTER_KEY || ''
  });

  await jarvis.init();
  console.log('🧠 Jarvis AI engine initialized');
  console.log(`📁 Memory file: ${MEMORY_FILE}`);
}

// ── Express App ─────────────────────────────────────────────
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/audio' });
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Auth tokens (simple session-based, like XLIX)
const validTokens = new Set();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function auth(req) {
  const header = req.headers.authorization || '';
  const token = header.replace('Bearer ', '').trim();
  if (token && validTokens.has(token)) return true;
  // Also allow without token for now for backwards compat
  return true;
}

const upload = multer({ dest: path.join(UPLOADS_DIR, 'temp') });

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api', (req, res) => {
  res.json({
    status: 'ok',
    name: 'Jarvis AI',
    version: '1.0.0',
    uptime: process.uptime(),
    memory: process.memoryUsage().rss
  });
});

// Chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const { message, userId } = req.body;
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Sanitize input
    const sanitized = security.sanitizeInput(message);
    if (!sanitized) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Set user context
    if (userId) {
      jarvis.context.userName = userId;
    }

    // Process through Jarvis AI
    const response = await jarvis.process(sanitized);

    res.json({
      response: response.text,
      emotion: response.emotion || 'neutral',
      skill: response.skill || null,
      timestamp: response.timestamp,
      conversationCount: jarvis.context.interactionCount
    });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Get conversation history
app.get('/history', (req, res) => {
  const count = parseInt(req.query.count) || 20;
  const history = jarvis.getConversationHistory(count);
  res.json({ history });
});

// Learn a pattern
app.post('/learn', async (req, res) => {
  try {
    const { input, response } = req.body;
    if (!input || !response) {
      return res.status(400).json({ error: 'Input and response required' });
    }
    await jarvis.learn(input, response);
    res.json({ status: 'learned' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get memory stats
app.get('/memory', (req, res) => {
  const history = jarvis.getConversationHistory(5);
  res.json({
    conversations: jarvis.context.interactionCount,
    recentHistory: history.length,
    userName: jarvis.context.userName
  });
});

// Reset memory
app.post('/reset', async (req, res) => {
  jarvis.memory.clear();
  jarvis.context.interactionCount = 0;
  await jarvis.memory.persist();
  res.json({ status: 'reset' });
});

// ── File System API ────────────────────────────────────────
app.post('/api/files/read', async (req, res) => {
  try {
    const { path: filePath } = req.body;
    const safePath = security.sanitizeInput(filePath || '');
    if (!safePath) return res.status(400).json({ error: 'Path required' });
    const fullPath = path.resolve(safePath);
    if (!fullPath.startsWith(process.cwd())) return res.status(403).json({ error: 'Access denied' });
    const content = fs.readFileSync(fullPath, 'utf-8');
    res.json({ content, size: content.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/files/write', async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    if (!filePath || content === undefined) return res.status(400).json({ error: 'Path and content required' });
    const fullPath = path.resolve(filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    res.json({ status: 'written', path: fullPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/files/delete', async (req, res) => {
  try {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'Path required' });
    fs.unlinkSync(path.resolve(filePath));
    res.json({ status: 'deleted' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/files/list', async (req, res) => {
  try {
    const dirPath = req.body.path || process.cwd();
    const items = fs.readdirSync(path.resolve(dirPath), { withFileTypes: true });
    const files = items.map(i => ({
      name: i.name,
      type: i.isDirectory() ? 'directory' : 'file',
      size: i.isFile() ? fs.statSync(path.join(dirPath, i.name)).size : 0
    }));
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Terminal API ───────────────────────────────────────────
app.post('/api/terminal/run', async (req, res) => {
  try {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'Command required' });
    const { execSync } = await import('child_process');
    const output = execSync(command, { encoding: 'utf-8', timeout: 30000, windowsHide: true });
    res.json({ output, exitCode: 0 });
  } catch (e) {
    res.json({ output: e.stdout || '', error: e.stderr || e.message, exitCode: e.status || 1 });
  }
});

// ── Skills list ────────────────────────────────────────────
app.get('/api/skills', (req, res) => {
  res.json({ skills: jarvis.skills.listSkills() });
});

// ── Push notification registration ─────────────────────────
const pushTokens = [];
app.post('/api/register-push', (req, res) => {
  const { token, platform } = req.body;
  if (token) {
    pushTokens.push({ token, platform, time: Date.now() });
    console.log(`Push token registered: ${platform} - ${token.slice(0, 20)}...`);
    res.json({ status: 'registered' });
  } else {
    res.status(400).json({ error: 'Token required' });
  }
});

// ── Web Search API ─────────────────────────────────────────
app.post('/api/web-search', async (req, res) => {
  try {
    const { query, count = 5 } = req.body;
    if (!query) return res.status(400).json({ error: 'Query required' });
    const { load } = await import('cheerio');
    const results = [];
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JarvisAI/1.0)' }
    });
    const html = await resp.text();
    const $ = load(html);
    $('.result').slice(0, count).each((i, el) => {
      const title = $(el).find('.result__title').text().trim();
      const snippet = $(el).find('.result__snippet').text().trim();
      const link = $(el).find('.result__url').attr('href') || '';
      if (title) results.push({ title, snippet, link });
    });
    res.json({ results, query });
  } catch (e) {
    res.status(500).json({ error: e.message, query: req.body.query });
  }
});

// ── Send Message API (via Twilio or webhook) ────────────────
app.post('/api/send-message', async (req, res) => {
  try {
    const { to, message, platform = 'sms' } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'Recipient and message required' });
    
    if (platform === 'sms' && process.env.TWILIO_SID) {
      // Twilio SMS
      const twilio = await import('twilio');
      const client = twilio.default(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
      await client.messages.create({ body: message, from: process.env.TWILIO_FROM, to });
      return res.json({ status: 'sent', platform: 'sms', to });
    }

    // Fallback: log it (no Twilio configured)
    console.log(`[Message] ${platform} → ${to}: ${message}`);
    res.json({ status: 'logged', platform, to, note: 'No SMS provider configured. Message was logged.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── App Launch API (mobile app deep links) ──────────────────
app.post('/api/launch-app', async (req, res) => {
  try {
    const { app: appName, action } = req.body;
    if (!appName) return res.status(400).json({ error: 'App name required' });
    
    const appSchemes = {
      'phone': 'tel://',
      'messages': 'sms://',
      'mail': 'mailto://',
      'maps': 'maps://',
      'music': 'music://',
      'photos': 'photos-redirect://',
      'camera': 'camera://',
      'settings': 'app-settings://',
      'safari': 'https://',
      'chrome': 'googlechrome://',
      'youtube': 'youtube://',
      'spotify': 'spotify://',
      'twitter': 'twitter://',
      'instagram': 'instagram://',
      'facebook': 'fb://',
      'whatsapp': 'whatsapp://',
      'telegram': 'tg://',
      'linkedin': 'linkedin://',
      'reddit': 'reddit://',
      'netflix': 'nflx://',
      'maps': 'maps://?q=',
    };

    const scheme = appSchemes[appName.toLowerCase()];
    if (scheme) {
      const url = scheme + (action || '');
      return res.json({ status: 'launch', app: appName, url, message: `Opening ${appName}...` });
    }

    // Web search fallback
    if (appName === 'web' || appName === 'browser') {
      return res.json({ status: 'launch', app: 'safari', url: `https://${action || 'google.com'}`, message: `Opening browser...` });
    }

    res.json({ status: 'unknown', app: appName, message: `Don't know how to launch ${appName} on mobile.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── File Upload (phone → PC, like XLIX) ─────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const destName = req.body.name || req.file.originalname;
    const destPath = path.join(UPLOADS_DIR, destName);
    fs.renameSync(req.file.path, destPath);
    console.log(`📁 File uploaded: ${destName} (${(req.file.size / 1024).toFixed(1)} KB)`);
    res.json({ status: 'uploaded', name: destName, size: req.file.size });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List uploaded files
app.get('/api/uploads', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR).filter(f => f !== 'temp').map(f => {
      const stat = fs.statSync(path.join(UPLOADS_DIR, f));
      return { name: f, size: stat.size, time: stat.mtime };
    });
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download uploaded file
app.get('/api/uploads/:name', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.download(filePath);
});

// ── Get auth token (like XLIX phone pairing) ───────────────
app.post('/api/auth', (req, res) => {
  const token = generateToken();
  validTokens.add(token);
  res.json({ token, expires: 'session' });
});

// ── WebSocket Voice (real-time audio, like XLIX Gemini Live) ──
wss.on('connection', (ws, req) => {
  console.log('🎤 Voice WebSocket connected');

  ws.on('message', async (data) => {
    try {
      if (data instanceof Buffer) {
        // Audio chunk received — process with Jarvis
        // For now, convert to text via a simple approach
        const text = data.toString('utf-8').trim();
        if (text && text.length > 2) {
          const response = await jarvis.process(text);
          ws.send(JSON.stringify({ type: 'response', text: response.text, emotion: response.emotion }));
        }
      } else {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'transcript') {
          const response = await jarvis.process(msg.text);
          ws.send(JSON.stringify({ type: 'response', text: response.text, emotion: response.emotion }));
        }
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (e) {
      console.error('Voice WS error:', e.message);
    }
  });

  ws.on('close', () => console.log('🎤 Voice WebSocket disconnected'));
  ws.send(JSON.stringify({ type: 'connected', name: 'Jarvis' }));
});

// ── Start ───────────────────────────────────────────────────
async function start() {
  await initJarvis();
  
  server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║     🧠  JARVIS CLOUD SERVER              ║');
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
    console.log(`  🌐  http://localhost:${PORT}`);
    console.log(`  📱  Connect from anywhere`);
    console.log(`  🧠  Shared memory for all devices`);
    console.log('');
  });
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});