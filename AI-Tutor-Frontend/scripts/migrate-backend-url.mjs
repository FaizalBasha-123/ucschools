/**
 * Script to replace inline backendUrlBase() functions with the shared import.
 * Run with: node scripts/migrate-backend-url.mjs
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('apps/web');

// Pattern 1: Full inline function definition (most common)
const PATTERNS = [
  // 6-line version with NEXT_PUBLIC first
  /function backendUrlBase\(\): string \{\s*\n\s*return \(\s*\n\s*process\.env\.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL \|\|\s*\n\s*process\.env\.AI_TUTOR_API_BASE_URL \|\|\s*\n\s*'http:\/\/127\.0\.0\.1:8099'\s*\n\s*\);\s*\n\}/g,
  // 5-line version
  /function backendUrlBase\(\): string \{\s*\n\s*return \(\s*\n\s*process\.env\.AI_TUTOR_API_BASE_URL \|\|\s*process\.env\.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL \|\|\s*\n\s*'http:\/\/127\.0\.0\.1:8099'\s*\n\s*\);\s*\n\}/g,
  // Single-return version
  /function backendUrlBase\(\): string \{\s*\n\s*return process\.env\.(?:NEXT_PUBLIC_)?AI_TUTOR_API_BASE_URL \|\| process\.env\.(?:NEXT_PUBLIC_)?AI_TUTOR_API_BASE_URL \|\| 'http:\/\/127\.0\.0\.1:8099';\s*\n\}/g,
];

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      results.push(...walk(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      results.push(full);
    }
  }
  return results;
}

let changed = 0;
for (const file of walk(ROOT)) {
  let content = fs.readFileSync(file, 'utf-8');
  if (!content.includes('function backendUrlBase')) continue;

  const original = content;

  // Remove the inline function
  content = content.replace(
    /\n?function backendUrlBase\(\): string \{[\s\S]*?\n\}\n?/g,
    '\n'
  );

  // Replace all calls: backendUrlBase() -> backendUrl()
  content = content.replace(/backendUrlBase\(\)/g, 'backendUrl()');

  // Add the import if not already present
  if (!content.includes("from '@/lib/server/backend-url'")) {
    // Find the last import line and add after it
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
