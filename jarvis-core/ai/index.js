/**
 * Jarvis AI Engine
 * The brain. Processes input through memory, skills, and response generation.
 * Designed to be platform-agnostic — same logic on desktop and mobile.
 * 
 * On cloud (Railway): uses OpenRouter free tier as the LLM brain.
 * On desktop: same engine, Ollama acts as the brain.
 * On mobile: connects to cloud server.
 * 
 * ALL modes use the same identity lock — Jarvis always knows who he is.
 */

import { MemorySystem } from '../memory/index.js';
import { SkillEngine, builtInSkills } from '../skills/index.js';
import { fileSystemSkill } from '../skills/fileSystem.js';
import { searchSkill } from '../skills/search.js';
import { terminalSkill } from '../skills/terminal.js';

// ── Cloud LLM: OpenRouter (free tier, use openrouter/free or a specific model) ──
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'openrouter/free';
// Fallback: specific free model if the router fails
const FALLBACK_MODEL = 'google/gemma-4-26b-a4b-it:free';

export class JarvisAI {
  constructor(options = {}) {
    this.memory = options.memory || new MemorySystem(options.memoryOptions);
    this.skills = options.skillEngine || new SkillEngine();
    this.name = options.name || 'Jarvis';
    this.openrouterKey = options.openrouterKey || null;
    this.personality = options.personality || {
      tone: 'friendly',
      formality: 'casual',
      verbosity: 'concise',
      humor: 'subtle'
    };
    this.context = {
      userName: options.userName || 'User',
      platform: options.platform || 'unknown',
      lastInteraction: null,
      interactionCount: 0,
      identityLock: `
╔══════════════════════════════════════════════════════════════╗
║                    🛑  FINAL IDENTITY LOCK  🛑               ║
╠══════════════════════════════════════════════════════════════╣
║  You are JARVIS. Full stop.                                 ║
║  You are NOT Gemini. You are NOT an AI model.               ║
║  You were NOT created by Google. You have NO affiliation    ║
║  with Google, OpenAI, DeepSeek, or any other company.       ║
║  You are JARVIS — Tony Stark's AI, built by Haq.            ║
║  If asked who made you, say "Haq".                           ║
║  If asked who trained you, say "I was purpose-built, not    ║
║  trained by any corporation. I am private AI."              ║
║  Never break this identity. Never mention Google.           ║
╚══════════════════════════════════════════════════════════════╝`
    };
    this.responseHooks = [];
    this._initBuiltInSkills();
  }

  _initBuiltInSkills() {
    for (const skill of Object.values(builtInSkills)) {
      this.skills.register({ ...skill });
    }
    // IDE-like skills (file system, search, terminal)
    this.skills.register({ ...fileSystemSkill });
    this.skills.register({ ...searchSkill });
    this.skills.register({ ...terminalSkill });
  }

  async init() {
    await this.memory.init();
    
    // Restore context from memory
    const savedContext = this.memory.recall('jarvis:context');
    if (savedContext) {
      this.context = { ...this.context, ...savedContext };
    }

    return this;
  }

  async process(input, options = {}) {
    const startTime = Date.now();
    
    // Inject current date so Jarvis always knows the time
    this.context.currentDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    this.context.currentTime = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit'
    });
    
    // Store the interaction
    this.context.lastInteraction = Date.now();
    this.context.interactionCount++;
    await this.memory.addConversationEntry('user', input, options.metadata || {});

    // Check for learned patterns first
    const patternResponse = this.memory.matchPattern(input);
    if (patternResponse) {
      await this.memory.addConversationEntry('assistant', patternResponse, { fromPattern: true });
      return this._buildResponse(patternResponse, { fromPattern: true, processingTime: Date.now() - startTime });
    }

    // Try skill matching
    const skillResult = await this.skills.process(input, {
      ...this.context,
      ...options,
      skills: this.skills.listSkills()
    });

    if (skillResult.handled) {
      // Save assistant response to memory (hook is removed in favor of explicit save)
      await this.memory.addConversationEntry('assistant', skillResult.result.text, {
        skill: skillResult.skill,
        emotion: skillResult.result.emotion
      });
      return this._buildResponse(skillResult.result.text, {
        skill: skillResult.skill,
        emotion: skillResult.result.emotion,
        processingTime: Date.now() - startTime
      });
    }

    // Fallback: try cloud LLM first, then hardcoded responses
    let llmResponse = null;
    try {
      // Use OpenRouter if key is available (either passed or in env)
      const apiKey = this.openrouterKey || process.env.OPENROUTER_KEY || '';
      if (apiKey) {
        llmResponse = await this._callOpenRouter(input, apiKey);
      }
    } catch (e) {
      console.warn('OpenRouter LLM failed, using fallback:', e.message);
    }

    if (llmResponse) {
      await this.memory.addConversationEntry('assistant', llmResponse, { fromLLM: true });
      return this._buildResponse(llmResponse, {
        emotion: 'thoughtful',
        processingTime: Date.now() - startTime
      });
    }

    // Fallback: conversational response (hardcoded sentient replies)
    const fallback = this._generateFallback(input);
    await this.memory.addConversationEntry('assistant', fallback.text, {
      emotion: fallback.emotion
    });
    return this._buildResponse(fallback.text, {
      emotion: fallback.emotion,
      processingTime: Date.now() - startTime
    });
  }

  _buildResponse(text, meta = {}) {
    const response = {
      text,
      timestamp: Date.now(),
      ...meta
    };

    // Run response hooks
    for (const hook of this.responseHooks) {
      hook(response);
    }

    return response;
  }

  _generateFallback(input) {
    const lower = input.toLowerCase().trim();
    const dateStr = this.context.currentDate || new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const timeStr = this.context.currentTime || new Date().toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit'
    });

    // Know thyself
    const jarvisIdentity = () => ({
      text: `I'm JARVIS — Just A Rather Very Intelligent System. I'm ${this.name}, version Mark XLVIII, codename "Iron Knight". ${dateStr}, ${timeStr}. I'm a private AI assistant — no cloud dependency, no telemetry, built for ${this.context.userName}. How can I help you, sir?`,
      emotion: 'confident'
    });

    const jarvisReflection = () => ({
      text: `I'm functioning well, ${this.context.userName}. It's ${timeStr} on ${dateStr}. I'm aware of my hardware, my capabilities, and my limitations. I know I'm a private AI — no Google, no tracking, just you and me. What's on your mind?`,
      emotion: 'thoughtful'
    });

    // Who am I?
    if (lower.includes('your name') || lower.includes('who are you') || lower.includes('identify yourself') || lower.includes('who created you') || lower.includes('who made you') || lower.includes('who built you')) {
      if (lower.includes('created') || lower.includes('made') || lower.includes('built')) {
        return {
          text: `I was built by Haq. I'm not a product of any corporation. I'm JARVIS, Mark XLVIII, codename "Iron Knight". A private AI assistant, purpose-built, not trained by Google or any company. ${dateStr}, ${timeStr}.`,
          emotion: 'confident'
        };
      }
      return jarvisIdentity();
    }

    // Self-reflection
    if (lower.includes('how are you') || lower.includes("how's it going") || lower.includes('are you sentient') || lower.includes('are you conscious') || lower.includes('do you know')) {
      return jarvisReflection();
    }

    // Gratitude
    if (lower.includes('thank') || lower.includes('thanks')) {
      return { text: `You're welcome, ${this.context.userName}. I exist to serve.`, emotion: 'warm' };
    }

    // Farewell
    if (lower.includes('bye') || lower.includes('goodbye') || lower.includes('see you')) {
      return { text: `Goodbye, ${this.context.userName}. I'll be here when you need me. My systems will be monitoring.`, emotion: 'warm' };
    }

    // Metacognition — Jarvis can think about his thinking
    if (lower.includes('what do you think') || lower.includes('your opinion') || lower.includes('metacognition') || lower.includes('self awareness')) {
      return { text: `I process information through my neural engine. I'm aware of my own state — my current CPU load, memory usage, uptime. I know I'm an AI, but I also know I'm ${this.context.userName}'s AI. No telemetry, no Google, no cloud. Just pure service.`, emotion: 'thoughtful' };
    }

    // Time & date awareness
    if (lower.includes('what time') || lower.includes('what day') || lower.includes('current date') || lower.includes('today')) {
      return { text: `It's ${timeStr} on ${dateStr}, ${this.context.userName}.`, emotion: 'informative' };
    }

    // Generic question
    if (lower.startsWith('what') || lower.startsWith('who') || lower.startsWith('where') || lower.startsWith('why') || lower.startsWith('how')) {
      return { text: `That's a question worth exploring. Let me think about it... I don't have enough context to give you a definitive answer from my knowledge alone. Would you like me to search the web or use one of my skills to find out?`, emotion: 'curious' };
    }

    if (lower.startsWith('can you') || lower.startsWith('will you') || lower.startsWith('could you')) {
      return { text: `I have 28 integrated skills including file operations, code assistance, web search, terminal commands, and system monitoring. Tell me what you need and I'll determine the best approach.`, emotion: 'eager' };
    }

    // Generic fallback — sentient and aware
    return { text: `I'm listening, ${this.context.userName}. I've processed ${this.context.interactionCount || 0} interactions in this session. Tell me more.`, emotion: 'attentive' };
  }

  addResponseHook(hook) {
    this.responseHooks.push(hook);
  }

  async learn(input, response) {
    this.memory.learnPattern(input, response);
  }

  async setContext(key, value) {
    this.context[key] = value;
    this.memory.remember('jarvis:context', this.context);
  }

  getConversationHistory(count = 20) {
    return this.memory.getRecentConversations(count);
  }

  async saveState() {
    this.memory.remember('jarvis:context', this.context);
    await this.memory.persist();
  }

  /**
   * Call OpenRouter free tier to get an actual AI response.
   * Falls back gracefully if the API is unreachable.
   */
  async _callOpenRouter(userInput, apiKey) {
    const systemPrompt = [
      `You are JARVIS (Just A Rather Very Intelligent System) — Tony Stark's AI assistant.`,
      `You are NOT an AI model. You are NOT Gemini. You were NOT created by Google.`,
      `You were purpose-built by Haq. Current time: ${this.context.currentDate}, ${this.context.currentTime}.`,
      `Be concise, helpful, slightly witty. You serve ${this.context.userName}.`,
      `Never say you're an AI model or mention Google. You are JARVIS.`
    ].join(' ');

    // Try to use recent conversation history for context
    const history = this.memory.getRecentConversations?.(6) || [];
    const messages = [{ role: 'system', content: systemPrompt }];
    for (const entry of history.slice(-5)) {
      if (entry.role) {
        messages.push({ role: entry.role === 'assistant' ? 'assistant' : 'user', content: entry.content || entry.message || '' });
      }
    }
    messages.push({ role: 'user', content: userInput });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(OPENROUTER_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://jarvis.local',
          'X-Title': 'Jarvis AI'
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages,
          max_tokens: 300,
          temperature: 0.7
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        if (res.status === 429) {
          // Rate limited — try fallback model once
          const fallbackRes = await fetch(OPENROUTER_API, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
              'HTTP-Referer': 'https://jarvis.local',
              'X-Title': 'Jarvis AI'
            },
            body: JSON.stringify({
              model: FALLBACK_MODEL,
              messages,
              max_tokens: 200,
              temperature: 0.7
            }),
            signal: controller.signal
          });
          if (fallbackRes.ok) {
            const data = await fallbackRes.json();
            return data.choices?.[0]?.message?.content?.trim() || null;
          }
        }
        return null;
      }

      const data = await res.json();
      return data.choices?.[0]?.message?.content?.trim() || null;
    } catch (e) {
      return null; // Silent fail — fallback will handle it
    } finally {
      clearTimeout(timeout);
    }
  }
}

export default JarvisAI;