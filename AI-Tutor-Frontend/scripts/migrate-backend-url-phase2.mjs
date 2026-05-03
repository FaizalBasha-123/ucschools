/**
 * Phase 2: Replace remaining inline backend URL patterns.
 * Handles:
 *   const backendUrl = process.env.NEXT_PUBLIC_... || process.env.AI_TUTOR_... || 'http://127.0.0.1:8099';
 *   const apiBaseUrl = process.env.AI_TUTOR_API_BASE_URL || 'http://127.0.0.1:8099';
 *   const backendBase = process.env...
 *   Inline function definitions in web-search/tavily, pbl/chat, parse-pdf etc.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('apps/web');

// Files to skip (test files, the shared helper itself)
const SKIP = ['backend-url.ts', '.test.ts'];

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      results.push(...walk(full));
    } else if ((entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) && !SKIP.some(s => entry.name.includes(s))) {
      results.push(full);
    }
  }
  return results;
}

let changed = 0;
for (const file of walk(ROOT)) {
  let content = fs.readFileSync(file, 'utf-8');
  if (!content.includes("'http://127.0.0.1:8099'") && !content.includes('"http://127.0.0.1:8099"')) continue;
  // Skip the centralized helper itself
  if (file.includes('backend-url.ts')) continue;

  const original = content;

  // Pattern: const backendUrl = process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL || process.env.AI_TUTOR_API_BASE_URL || 'http://127.0.0.1:8099';
  content = content.replace(
    /const (backendUrl|apiBaseUrl|backendBase)\s*=\s*process\.env\.(?:NEXT_PUBLIC_)?AI_TUTOR_API_BASE_URL\s*\|\|\s*(?:process\.env\.(?:NEXT_PUBLIC_)?AI_TUTOR_API_BASE_URL\s*\|\|\s*)?'http:\/\/127\.0\.0\.1:8099';/g,
    'const $1 = backendUrl();'
  );

  // Pattern: inline backendBase() function in tavily/pbl/parse-pdf etc.
  content = content.replace(
    /\n?(?:function|const) backendBase(?:\(\): string)? (?:=>\s*)?(?:\{[\s\S]*?'http:\/\/127\.0\.0\.1:8099'[\s\S]*?\}|=\s*[\s\S]*?'http:\/\/127\.0\.0\.1:8099'[\s\S]*?;)\n?/g,
    '\n'
  );

  // Pattern: api-costs style with backendUrlBase already removed but a dangling function
  // Handle remaining function backendUrlBase patterns
  content = content.replace(
    /\n?function backendUrlBase\(\): string \{[\s\S]*?\n\}\n?/g,
    '\n'
  );

  // Replace backendBase() calls with backendUrl()
  content = content.replace(/backendBase\(\)/g, 'backendUrl()');

  // Add the import if not already present and if we made changes
  if (content !== original && !content.includes("from '@/lib/server/backend-url'")) {
    const lines = content.split('\n');
    let lastImportIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('import ')) lastImportIdx = i;
    }
    if (lastImportIdx >= 0) {
      lines.splice(lastImportIdx + 1, 0, "import { backendUrl } from '@/lib/server/backend-url';");
    } else {
      lines.unshift("import { backendUrl } from '@/lib/server/backend-url';");
    }
    content = lines.join('\n');
  }

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf-8');
    console.log(`✓ ${path.relative(ROOT, file)}`);
    changed++;
  }
}

console.log(`\nDone. ${changed} files updated.`);
