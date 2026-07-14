/**
 * Jarvis File System Skill
 * 
 * Lets Jarvis read, write, create, delete, move files and list directories.
 * Like VSCode's file explorer but controlled by conversation.
 * 
 * Works on the server (desktop/cloud) — mobile requests go through the API.
 */

import fs from 'fs';
import path from 'path';

export const fileSystemSkill = {
  name: 'fileSystem',
  description: 'Read, write, create, delete, move files and list directories',
  requiresConfirmation: true,
  matcher: (input) => {
    const keywords = [
      'read file', 'write file', 'create file', 'delete file', 'move file',
      'list files', 'show files', 'open file', 'save file', 'make file',
      'rename file', 'copy file', 'new file', 'create folder', 'list directory',
      'what files', 'file tree', 'browse files', 'find file'
    ];
    for (const kw of keywords) {
      if (input.includes(kw)) return 0.85;
    }
    if (input.includes('file') || input.includes('folder') || input.includes('directory')) return 0.5;
    return 0;
  },
  execute: async (ctx) => {
    const { rawInput, workspaceRoot } = ctx;
    if (!rawInput) return { text: 'What file operation would you like to perform?', emotion: 'neutral' };

    const root = workspaceRoot || process.cwd();
    const lower = rawInput.toLowerCase();

    // ── Read file ──
    if (lower.includes('read') || lower.includes('open') || lower.includes('show')) {
      const filePath = extractPath(rawInput, root);
      if (!filePath) return { text: 'Which file should I read? Tell me the path.', emotion: 'neutral' };
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const summary = lines.length > 50
          ? `\`${path.basename(filePath)}\` (${lines.length} lines, ${content.length} chars)\n\`\`\`\n${lines.slice(0, 50).join('\n')}\n... (${lines.length - 50} more lines)\n\`\`\``
          : `\`${path.basename(filePath)}\` (${lines.length} lines)\n\`\`\`\n${content}\n\`\`\``;
        return { text: summary, emotion: 'neutral' };
      } catch (e) {
        return { text: `Can't read file: ${e.message}`, emotion: 'error' };
      }
    }

    // ── Write file ──
    if (lower.includes('write') || lower.includes('save') || lower.includes('update')) {
      // Extract content from context — user needs to provide it
      return { text: 'What content should I write? Tell me the file path and content.', emotion: 'neutral' };
    }

    // ── Create file ──
    if (lower.includes('create') || lower.includes('new file') || lower.includes('make file')) {
      const filePath = extractPath(rawInput, root);
      if (!filePath) return { text: 'What file should I create? Tell me the path.', emotion: 'neutral' };
      try {
        if (fs.existsSync(filePath)) return { text: `File already exists: ${filePath}`, emotion: 'warning' };
        fs.writeFileSync(filePath, '', 'utf-8');
        return { text: `✅ Created empty file: \`${filePath}\``, emotion: 'happy' };
      } catch (e) {
        return { text: `Can't create file: ${e.message}`, emotion: 'error' };
      }
    }

    // ── Delete file ──
    if (lower.includes('delete') || lower.includes('remove') || lower.includes('trash')) {
      const filePath = extractPath(rawInput, root);
      if (!filePath) return { text: 'Which file should I delete? Tell me the path.', emotion: 'neutral' };
      try {
        fs.unlinkSync(filePath);
        return { text: `🗑️ Deleted: \`${filePath}\``, emotion: 'neutral' };
      } catch (e) {
        return { text: `Can't delete file: ${e.message}`, emotion: 'error' };
      }
    }

    // ── Move/Rename file ──
    if (lower.includes('move') || lower.includes('rename') || lower.includes('copy')) {
      const paths = extractTwoPaths(rawInput, root);
      if (!paths) return { text: 'Tell me the source and destination paths.', emotion: 'neutral' };
      try {
        if (lower.includes('copy')) {
          fs.cpSync(paths[0], paths[1], { recursive: true });
          return { text: `📋 Copied: \`${paths[0]}\` → \`${paths[1]}\``, emotion: 'happy' };
        } else {
          fs.renameSync(paths[0], paths[1]);
          return { text: `📦 Moved: \`${paths[0]}\` → \`${paths[1]}\``, emotion: 'happy' };
        }
      } catch (e) {
        return { text: `Can't move file: ${e.message}`, emotion: 'error' };
      }
    }

    // ── List files ──
    if (lower.includes('list') || lower.includes('show files') || lower.includes('file tree') || lower.includes('browse')) {
      const dirPath = extractPath(rawInput, root) || root;
      try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        const files = items.filter(i => i.isFile()).map(i => `  📄 ${i.name}`);
        const dirs = items.filter(i => i.isDirectory()).map(i => `  📁 ${i.name}/`);
        const result = [...dirs, ...files].join('\n');
        return { text: `📂 \`${dirPath}\`\n${result || '  (empty)'}`, emotion: 'neutral' };
      } catch (e) {
        return { text: `Can't list directory: ${e.message}`, emotion: 'error' };
      }
    }

    // ── Create folder ──
    if (lower.includes('create folder') || lower.includes('make directory') || lower.includes('mkdir')) {
      const dirPath = extractPath(rawInput, root);
      if (!dirPath) return { text: 'What directory should I create?', emotion: 'neutral' };
      try {
        fs.mkdirSync(dirPath, { recursive: true });
        return { text: `✅ Created directory: \`${dirPath}\``, emotion: 'happy' };
      } catch (e) {
        return { text: `Can't create directory: ${e.message}`, emotion: 'error' };
      }
    }

    return { text: 'File operation not recognized. Try: read, write, create, delete, move, list, or create folder.', emotion: 'neutral' };
  }
};

// ── Helpers ──

function extractPath(input, root) {
  // Try to find a quoted path first
  const quoteMatch = input.match(/"([^"]+)"/) || input.match(/'([^']+)'/);
  if (quoteMatch) return path.resolve(root, quoteMatch[1]);

  // Try to find a path-like pattern
  const words = input.split(/\s+/);
  for (const word of words) {
    const clean = word.replace(/[.,!?;:]+$/, '');
    if (clean.includes('/') || clean.includes('\\') || clean.includes('.')) {
      return path.resolve(root, clean);
    }
  }
  return null;
}

function extractTwoPaths(input, root) {
  const quotes = input.match(/"([^"]+)"\s*(?:to|->|=>|>)\s*"([^"]+)"/) ||
                 input.match(/'([^']+)'\s*(?:to|->|=>|>)\s*'([^']+)'/);
  if (quotes) return [path.resolve(root, quotes[1]), path.resolve(root, quotes[2])];

  // Fallback: last two path-like words
  const words = input.split(/\s+/).filter(w => w.includes('/') || w.includes('\\') || w.includes('.'));
  if (words.length >= 2) {
    return [path.resolve(root, words[words.length - 2]), path.resolve(root, words[words.length - 1])];
  }
  return null;
}

export default fileSystemSkill;