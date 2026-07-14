/**
 * Jarvis Terminal Skill
 * 
 * Lets Jarvis run terminal commands, open programs, and capture output.
 * Like VSCode's integrated terminal but controlled by conversation.
 * 
 * ⚠️ Only works on desktop/cloud server — mobile requests go through API.
 */

import { execSync, spawn } from 'child_process';
import path from 'path';

export const terminalSkill = {
  name: 'terminal',
  description: 'Run terminal commands, open programs, and execute scripts',
  requiresConfirmation: true,
  matcher: (input) => {
    const keywords = [
      'run command', 'run terminal', 'execute', 'open terminal',
      'run program', 'start app', 'open app', 'launch',
      'run script', 'npm', 'node', 'python', 'git', 'cd', 'ls', 'dir',
      'show me the output', 'run tests', 'compile', 'build'
    ];
    for (const kw of keywords) {
      if (input.includes(kw)) return 0.85;
    }
    return 0;
  },
  execute: async (ctx) => {
    const { rawInput, workspaceRoot } = ctx;
    if (!rawInput) return { text: 'What command would you like me to run?', emotion: 'neutral' };

    const root = workspaceRoot || process.cwd();
    const lower = rawInput.toLowerCase();

    // ── Extract command ──
    let command = extractCommand(rawInput);
    if (!command) return { text: 'What command should I run?', emotion: 'neutral' };

    // Safety check
    if (isDangerousCommand(command)) {
      return { text: `⚠️ I can't run \`${command}\` — it could be dangerous. Try a safer command.`, emotion: 'error' };
    }

    try {
      const output = execSync(command, {
        cwd: root,
        encoding: 'utf-8',
        timeout: 30000,
        maxBuffer: 50 * 1024,
        windowsHide: true
      });

      const trimmed = output.trim();
      if (!trimmed) {
        return { text: `✅ Command \`${command}\` ran successfully (no output).`, emotion: 'happy' };
      }

      // Truncate long output
      const lines = trimmed.split('\n');
      const display = lines.length > 30
        ? lines.slice(0, 30).join('\n') + `\n... (${lines.length - 30} more lines)`
        : trimmed;

      return { text: `\`\`\`\n${display}\n\`\`\``, emotion: 'neutral' };
    } catch (e) {
      const errorMsg = e.stderr || e.message || 'Unknown error';
      return { text: `❌ Command failed:\n\`\`\`\n${errorMsg.slice(0, 1000)}\n\`\`\``, emotion: 'error' };
    }
  }
};

function extractCommand(input) {
  // Backtick command
  const backtickMatch = input.match(/`([^`]+)`/);
  if (backtickMatch) return backtickMatch[1];

  // After "run" or "execute"
  const runMatch = input.match(/(?:run|execute|do)\s+`?([^.!?]+)`?/i);
  if (runMatch) {
    const cmd = runMatch[1].trim();
    if (cmd.length > 1) return cmd;
  }

  // If it starts with a common command
  const common = ['npm', 'node', 'python', 'git', 'ls', 'dir', 'cd ', 'echo', 'cat ', 'type ', 'mkdir', 'ping', 'ipconfig', 'systeminfo'];
  for (const c of common) {
    if (input.startsWith(c) || input.includes(` ${c}`)) {
      return input.split(/\s+/).slice(0, 5).join(' ');
    }
  }

  return null;
}

const dangerousPatterns = [
  /rm\s+-rf\s+\//, /format\s+\w:/, /del\s+\/f/, /rd\s+\/s/,
  /shutdown/, /restart/, /reg\s+delete/, />\s*nul/, /:\s*>/
];

function isDangerousCommand(cmd) {
  return dangerousPatterns.some(p => p.test(cmd));
}

export default terminalSkill;