/**
 * Jarvis Core Test Suite
 * Run with: node test.js
 * Tests the shared Jarvis engine (memory, skills, AI, security)
 */

import { JarvisAI, MemorySystem, SkillEngine, SecurityGate } from './index.js';

class TestSyncAdapter {
  constructor() { this.data = null; }
  async load() { return this.data; }
  async save(snapshot) { this.data = snapshot; return true; }
}

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n🧪 Jarvis Core Test Suite\n');

  // --- Memory System Tests ---
  console.log('📦 Memory System');
  const memory = new MemorySystem({ syncAdapter: new TestSyncAdapter() });
  await memory.init();

  memory.remember('test_key', 'hello world');
  assert(memory.recall('test_key') === 'hello world', 'Remember and recall basic value');

  memory.remember('number_key', 42);
  assert(memory.recall('number_key') === 42, 'Store and retrieve numbers');

  memory.remember('obj_key', { name: 'Jarvis', version: 1 });
  assert(memory.recall('obj_key').name === 'Jarvis', 'Store and retrieve objects');

  memory.forget('test_key');
  assert(memory.recall('test_key') === null, 'Forget removes key');

  // Namespace
  const ns = memory.namespace('test');
  ns.set('foo', 'bar');
  assert(ns.get('foo') === 'bar', 'Namespace set/get');

  // Preferences
  memory.setPreference('theme', 'dark');
  assert(memory.getPreference('theme') === 'dark', 'Preference storage');

  // Conversations
  await memory.addConversationEntry('user', 'Hello');
  await memory.addConversationEntry('assistant', 'Hi there!');
  const history = memory.getRecentConversations(5);
  assert(history.length === 2, 'Conversation history');
  // Most recent entry is first (assistant was added last)
  assert(history[0].role === 'assistant', 'Conversation entry role (most recent first)');
  assert(history[0].content === 'Hi there!', 'Conversation entry content (most recent first)');

  // Patterns
  memory.learnPattern('hello jarvis', 'Hello! How can I help?');
  assert(memory.matchPattern('hello jarvis') === 'Hello! How can I help?', 'Pattern learning and matching');
  assert(memory.matchPattern('unknown phrase') === null, 'No match for unknown pattern');

  // --- Skill Engine Tests ---
  console.log('\n🔧 Skill Engine');
  const skills = new SkillEngine();

  skills.register({
    name: 'echo',
    description: 'Echoes input',
    matcher: (input) => input.includes('echo') ? 1.0 : 0,
    execute: async (ctx) => ({ text: `Echo: ${ctx.rawInput}`, emotion: 'neutral' })
  });

  skills.register({
    name: 'disabled_skill',
    description: 'Should not run',
    enabled: false,
    matcher: (input) => 1.0,
    execute: async () => ({ text: 'should not see this' })
  });

  const list = skills.listSkills();
  assert(list.length === 2, 'Skill registration');
  assert(list.find(s => s.name === 'echo').enabled === true, 'Enabled skill');
  assert(list.find(s => s.name === 'disabled_skill').enabled === false, 'Disabled skill');

  const match = await skills.matchIntent('say echo please');
  assert(match !== null, 'Intent matching');
  assert(match.name === 'echo', 'Correct skill matched');
  assert(match.confidence === 1.0, 'Confidence score');

  const noMatch = await skills.matchIntent('nothing relevant');
  assert(noMatch === null, 'No match for irrelevant input');

  const result = await skills.execute('echo', { rawInput: 'test' });
  assert(result.text === 'Echo: test', 'Skill execution');

  // Disabled skill
  try {
    await skills.execute('disabled_skill', {});
    assert(false, 'Disabled skill should throw');
  } catch (e) {
    assert(true, 'Disabled skill throws error');
  }

  // Hooks
  let hookRan = false;
  skills.addHook('beforeAll', async () => { hookRan = true; });
  await skills.execute('echo', { rawInput: 'hook test' });
  assert(hookRan, 'Hook execution');

  // --- Jarvis AI Tests ---
  console.log('\n🤖 Jarvis AI');
  const aiMem = new MemorySystem({ syncAdapter: new TestSyncAdapter() });
  const aiSkills = new SkillEngine();
  const ai = new JarvisAI({ memory: aiMem, skillEngine: aiSkills, name: 'Jarvis', userName: 'Tester' });
  await ai.init();

  // Built-in skills
  let response = await ai.process('Hello');
  assert(response.text.includes('Hello') || response.text.includes('hi') || response.text.includes('Good'), 'Greeting response');

  response = await ai.process('What time is it?');
  assert(response.text.includes(':'), 'Time response');

  response = await ai.process('help');
  assert(response.text.includes('help') || response.text.includes('can do'), 'Help response');

  // Fallback responses
  response = await ai.process('How are you?');
  assert(response.text.includes('question') || response.text.includes('great') || response.text.includes('Ready'), 'How are you response');

  response = await ai.process('Thank you');
  assert(response.text.includes('welcome'), 'Thank you response');

  response = await ai.process('Goodbye');
  assert(response.text.includes('Goodbye') || response.text.includes('here if'), 'Goodbye response');

  response = await ai.process('Who are you?');
  assert(response.text.includes('Jarvis'), 'Name response');

  // Response hooks
  let hookData = null;
  ai.addResponseHook((resp) => { hookData = resp; });
  await ai.process('Hello');
  assert(hookData !== null, 'Response hook fires');
  if (hookData) {
    assert(hookData.text !== undefined, 'Hook has text');
    assert(hookData.timestamp !== undefined, 'Hook has timestamp');
  }

  // Memory integration
  const convHistory = ai.getConversationHistory(3);
  assert(convHistory.length > 0, 'AI stores conversation history');

  // Context
  await ai.setContext('userName', 'TestUser');
  const respWithName = await ai.process('Goodbye');
  assert(respWithName.text.includes('TestUser'), 'Context-aware response');

  // --- Security Gate Tests ---
  console.log('\n🔒 Security Gate');
  const security = new SecurityGate({ sessionExpiry: 60000 });

  // Input sanitization
  const dirty = '<script>alert("xss")</script>Hello';
  assert(security.sanitizeInput(dirty) === 'Hello', 'XSS sanitization');

  const clean = 'Hello Jarvis, how are you?';
  assert(security.sanitizeInput(clean) === clean, 'Clean input unchanged');

  // URL validation
  const urlResult = security.validateURL('https://example.com');
  assert(urlResult.valid === true, 'Valid HTTPS URL');

  const badUrl = security.validateURL('javascript:alert(1)');
  assert(badUrl.valid === false, 'Dangerous URL rejected');

  // Sensitive actions
  let perm = await security.checkPermission('say_hello');
  assert(perm.allowed === true, 'Non-sensitive action allowed');

  // Audit log
  const log = security.getAuditLog();
  assert(log.length > 0, 'Audit log entries');
  assert(log[0].type === 'permission_check', 'Audit log type');

  // Status report
  const status = security.getStatus();
  assert(status.sensitiveActions.includes('send_message'), 'Sensitive actions listed');
  assert(status.auditLogCount > 0, 'Status audit count');

  // --- Integrated Flow Test ---
  console.log('\n🔄 Integrated Flow');
  const fullMemory = new MemorySystem({ syncAdapter: new TestSyncAdapter() });
  const fullSkills = new SkillEngine();
  const fullSecurity = new SecurityGate();
  const jarvis = new JarvisAI({ memory: fullMemory, skillEngine: fullSkills, name: 'Jarvis' });
  await jarvis.init();

  // Full conversation flow
  let conv = await jarvis.process('Hello Jarvis!');
  assert(conv.text.length > 0, 'Integrated: greeting');

  conv = await jarvis.process('What can you do?');
  assert(conv.skill === 'help' || conv.text.includes('can do'), 'Integrated: help');

  conv = await jarvis.process('Thanks!');
  assert(conv.text.length > 0, 'Integrated: thanks');

  // Verify conversation stored
  const fullHistory = jarvis.getConversationHistory(10);
  assert(fullHistory.length >= 5, 'Integrated: conversations stored'); // 3 user + 2+ assistant

  // --- Summary ---
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`${'='.repeat(40)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});