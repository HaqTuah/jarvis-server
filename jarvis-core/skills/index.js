/**
 * Jarvis Skill Engine
 * Pluggable skill system. Skills are modules that Jarvis can invoke
 * based on intent matching. Shared across desktop and mobile.
 */

export class SkillEngine {
  constructor() {
    this.skills = new Map();
    this.hooks = { beforeAll: [], afterAll: [] };
  }

  register(skill) {
    if (!skill.name || !skill.execute) {
      throw new Error('Skill must have a name and execute() method');
    }
    this.skills.set(skill.name, {
      ...skill,
      enabled: skill.enabled !== false
    });
    return this;
  }

  unregister(name) {
    this.skills.delete(name);
    return this;
  }

  getSkill(name) {
    return this.skills.get(name);
  }

  listSkills() {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name,
      description: s.description || '',
      enabled: s.enabled,
      requiresAuth: s.requiresAuth || false,
      requiresConfirmation: s.requiresConfirmation || false
    }));
  }

  enable(name) {
    const skill = this.skills.get(name);
    if (skill) skill.enabled = true;
  }

  disable(name) {
    const skill = this.skills.get(name);
    if (skill) skill.enabled = false;
  }

  addHook(type, fn) {
    if (this.hooks[type]) this.hooks[type].push(fn);
  }

  async matchIntent(input) {
    const normalized = input.toLowerCase().trim();
    const matches = [];

    for (const [name, skill] of this.skills) {
      if (!skill.enabled) continue;
      if (!skill.matcher) continue;

      const confidence = skill.matcher(normalized);
      if (confidence > 0) {
        matches.push({ name, skill, confidence });
      }
    }

    matches.sort((a, b) => b.confidence - a.confidence);
    return matches.length > 0 ? matches[0] : null;
  }

  async execute(name, context = {}) {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill "${name}" not found`);
    if (!skill.enabled) throw new Error(`Skill "${name}" is disabled`);

    // Run beforeAll hooks
    for (const hook of this.hooks.beforeAll) {
      await hook({ name, context });
    }

    const result = await skill.execute(context);

    // Run afterAll hooks
    for (const hook of this.hooks.afterAll) {
      await hook({ name, context, result });
    }

    return result;
  }

  async process(input, context = {}) {
    const match = await this.matchIntent(input);
    if (!match) return { handled: false, response: null };

    const result = await this.execute(match.name, {
      ...context,
      rawInput: input,
      matchedIntent: match.name,
      confidence: match.confidence
    });

    return { handled: true, skill: match.name, result };
  }
}

/**
 * Built-in skills that come with Jarvis
 */

export const builtInSkills = {
  /**
   * Greeting skill
   */
  greeting: {
    name: 'greeting',
    description: 'Responds to greetings',
    matcher: (input) => {
      const tokens = input.split(/\s+/);
      const greetings = ['hello', 'hi', 'hey', 'sup', 'yo', 'howdy', 'good morning', 'good evening', 'good afternoon'];
      for (const g of greetings) {
        const words = g.split(' ');
        if (words.length === 1 && tokens.includes(g)) return 0.9;
        if (words.length > 1 && input.includes(g)) return 0.9;
      }
      return 0;
    },
    execute: async (ctx) => {
      const hour = new Date().getHours();
      let timeGreeting = 'Hello';
      if (hour < 12) timeGreeting = 'Good morning';
      else if (hour < 18) timeGreeting = 'Good afternoon';
      else timeGreeting = 'Good evening';
      return { text: `${timeGreeting}! I'm Jarvis. How can I help you?`, emotion: 'happy' };
    }
  },

  /**
   * Time/date skill
   */
  timeDate: {
    name: 'timeDate',
    description: 'Tells the current time and date',
    matcher: (input) => {
      if (input.includes('time') || input.includes('date') || input.includes('what day') || input.includes('what month')) return 0.85;
      if (input.includes('when') && (input.includes('now') || input.includes('today'))) return 0.7;
      return 0;
    },
    execute: async () => {
      const now = new Date();
      const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const date = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      return { text: `It's ${time} on ${date}.`, emotion: 'neutral' };
    }
  },

  /**
   * Weather skill (placeholder - needs API key)
   */
  weather: {
    name: 'weather',
    description: 'Gets weather information',
    enabled: false,
    requiresAuth: true,
    matcher: (input) => {
      if (input.includes('weather') || input.includes('temperature') || input.includes('forecast')) return 0.8;
      if (input.includes('rain') || input.includes('sunny') || input.includes('cloudy')) return 0.7;
      return 0;
    },
    execute: async (ctx) => {
      return { text: 'Weather skill needs an API key configured.', emotion: 'neutral' };
    }
  },

  /**
   * Reminder skill
   */
  reminder: {
    name: 'reminder',
    description: 'Sets and manages reminders',
    requiresConfirmation: true,
    matcher: (input) => {
      if (input.includes('remind') || input.includes('reminder') || input.includes('remember to')) return 0.9;
      if (input.includes('don\'t forget') || input.includes('set a reminder')) return 0.85;
      return 0;
    },
    execute: async (ctx) => {
      return { text: 'I\'ll remember that. What should I remind you about?', emotion: 'thoughtful' };
    }
  },

  /**
   * Help skill
   */
  help: {
    name: 'help',
    description: 'Lists available skills and capabilities',
    matcher: (input) => {
      if (input.includes('help') || input.includes('what can you do') || input.includes('capabilities') || input.includes('commands')) return 0.9;
      if (input.includes('how do you') || input.includes('what are you')) return 0.6;
      return 0;
    },
    execute: async (ctx) => {
      const skills = ctx.skills || [];
      const list = skills.map(s => `• **${s.name}**: ${s.description}`).join('\n');
      return {
        text: `Here's what I can do:\n${list}\n\nJust tell me what you need!`,
        emotion: 'helpful'
      };
    }
  }
};

export default SkillEngine;