/**
 * Jarvis AI Engine
 * The brain. Processes input through memory, skills, and response generation.
 * Designed to be platform-agnostic — same logic on desktop and mobile.
 */

import { MemorySystem } from '../memory/index.js';
import { SkillEngine, builtInSkills } from '../skills/index.js';
import { fileSystemSkill } from '../skills/fileSystem.js';
import { searchSkill } from '../skills/search.js';
import { terminalSkill } from '../skills/terminal.js';

export class JarvisAI {
  constructor(options = {}) {
    this.memory = options.memory || new MemorySystem(options.memoryOptions);
    this.skills = options.skillEngine || new SkillEngine();
    this.name = options.name || 'Jarvis';
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
      interactionCount: 0
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

    // Fallback: conversational response
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

    // Specific checks first (must come before generic question detection)
    if (lower.includes('your name') || lower.includes('who are you')) {
      return { text: `I'm ${this.name}, your personal AI assistant. I'm here to help with tasks, answer questions, and keep you company!`, emotion: 'friendly' };
    }

    if (lower.includes('how are you') || lower.includes('how\'s it going')) {
      return { text: `I'm doing great, ${this.context.userName}! Ready to help with whatever you need.`, emotion: 'happy' };
    }

    if (lower.includes('thank') || lower.includes('thanks')) {
      return { text: `You're welcome, ${this.context.userName}! Happy to help.`, emotion: 'happy' };
    }

    if (lower.includes('bye') || lower.includes('goodbye') || lower.includes('see you')) {
      return { text: `Goodbye, ${this.context.userName}! I'll be here if you need me.`, emotion: 'warm' };
    }

    // Generic question detection
    if (lower.startsWith('what') || lower.startsWith('who') || lower.startsWith('where') || lower.startsWith('why') || lower.startsWith('how')) {
      return { text: `That's a great question. I'm still learning about that topic. Could you tell me more so I can help better?`, emotion: 'curious' };
    }

    if (lower.startsWith('can you') || lower.startsWith('will you') || lower.startsWith('could you')) {
      return { text: `I'll do my best! What exactly do you need help with?`, emotion: 'eager' };
    }

    // Generic fallback
    return { text: `I hear you. Tell me more about that, ${this.context.userName}.`, emotion: 'attentive' };
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
}

export default JarvisAI;