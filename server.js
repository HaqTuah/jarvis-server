/**
 * Jarvis Cloud Server
 * 
 * Runs the Jarvis AI engine 24/7 on free cloud hosting.
 * Desktop and mobile both connect to the same instance.
 * Shared memory, shared skills — everyone talks to the same Jarvis.
 * 
 * Deploy to: Railway, Render, Fly.io, or any Node.js host
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Jarvis Core Engine ──────────────────────────────────────
import { JarvisAI, MemorySystem, SkillEngine, SecurityGate } from '../jarvis-core/index.js';

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
    platform: 'cloud'
  });

  await jarvis.init();
  console.log('🧠 Jarvis AI engine initialized');
  console.log(`📁 Memory file: ${MEMORY_FILE}`);
}

// ── Express App ─────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

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

// ── Start ───────────────────────────────────────────────────
async function start() {
  await initJarvis();
  
  app.listen(PORT, '0.0.0.0', () => {
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