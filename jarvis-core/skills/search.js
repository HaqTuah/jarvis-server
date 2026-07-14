/**
 * Jarvis File Search Skill
 * 
 * Search files by name, content, and patterns.
 * Like VSCode's search (Ctrl+Shift+F) but conversational.
 */

import fs from 'fs';
import path from 'path';

export const searchSkill = {
  name: 'search',
  description: 'Search files by name, content, or pattern across the workspace',
  matcher: (input) => {
    const keywords = [
      'search files', 'find files', 'search for', 'find in files',
      'search content', 'grep', 'look for', 'locate file',
      'find references', 'find where', 'search code'
    ];
    for (const kw of keywords) {
      if (input.includes(kw)) return 0.9;
    }
    if (input.includes('search') || input.includes('find') || input.includes('locate')) return 0.6;
    return 0;
  },
  execute: async (ctx) => {
    const { rawInput, workspaceRoot } = ctx;
    if (!rawInput) return { text: 'What would you like me to search for?', emotion: 'neutral' };

    const root = workspaceRoot || process.cwd();
    const lower = rawInput.toLowerCase();

    // Extract search term
    const term = extractSearchTerm(rawInput);
    if (!term) return { text: 'What should I search for? Give me a filename or text pattern.', emotion: 'neutral' };

    // Check if searching by file type
    const extFilter = extractExtension(lower);

    const results = [];
    const maxResults = 20;

    try {
      walkDir(root, root, term, extFilter, results, maxResults);
      
      if (results.length === 0) {
        return { text: `No results found for "${term}"${extFilter ? ` in ${extFilter} files` : ''}.`, emotion: 'neutral' };
      }

      const lines = results.map(r => `  ${r.relative}`).join('\n');
      return {
        text: `🔍 Found ${results.length} result${results.length > 1 ? 's' : ''} for "${term}"${extFilter ? ` in ${extFilter} files` : ''}:\n\n${lines}`,
        emotion: 'neutral'
      };
    } catch (e) {
      return { text: `Search error: ${e.message}`, emotion: 'error' };
    }
  }
};

function walkDir(dir, root, term, extFilter, results, maxResults) {
  if (results.length >= maxResults) return;
  
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const item of items) {
    if (results.length >= maxResults) break;
    if (item.name.startsWith('.') || item.name === 'node_modules') continue;

    const fullPath = path.join(dir, item.name);
    const relative = path.relative(root, fullPath);

    if (item.isDirectory()) {
      walkDir(fullPath, root, term, extFilter, results, maxResults);
    } else if (item.isFile()) {
      // Check extension filter
      if (extFilter && !item.name.endsWith(extFilter)) continue;

      // Check if filename matches
      if (item.name.toLowerCase().includes(term.toLowerCase())) {
        results.push({ path: fullPath, relative });
        continue;
      }

      // Check file content (first 4KB)
      try {
        const content = fs.readFileSync(fullPath, 'utf-8').slice(0, 4096);
        if (content.toLowerCase().includes(term.toLowerCase())) {
          results.push({ path: fullPath, relative });
        }
      } catch {
        // Skip binary files
      }
    }
  }
}

function extractSearchTerm(input) {
  // Quoted string
  const quoteMatch = input.match(/"([^"]+)"/) || input.match(/'([^']+)'/);
  if (quoteMatch) return quoteMatch[1];

  // After "for" or "search"
  const forMatch = input.match(/(?:search|find|for|look)\s+(?:for|of|in|at)?\s+(.+)/i);
  if (forMatch) {
    const term = forMatch[1].replace(/files?$/i, '').trim();
    if (term.length > 1) return term;
  }

  return null;
}

function extractExtension(input) {
  const extMatch = input.match(/\.(js|ts|jsx|tsx|py|html|css|json|md|txt|bat|sh|yml|yaml|toml|env|gitignore)\b/);
  if (extMatch) return `.${extMatch[1]}`;

  const langMatch = input.match(/(javascript|typescript|python|html|css|json|markdown|text)\s+files?/i);
  const langMap = { javascript: '.js', typescript: '.ts', python: '.py', html: '.html', css: '.css', json: '.json', markdown: '.md', text: '.txt' };
  if (langMatch && langMap[langMatch[1].toLowerCase()]) return langMap[langMatch[1].toLowerCase()];

  return null;
}

export default searchSkill;