/**
 * Fix variable shadowing: const backendUrl = backendUrl() -> remove the const, use backendUrl() directly in template literals.
 */
import fs from 'fs';
import path from 'path';

const files = [
  'apps/web/lib/web-search/tavily.ts',
  'apps/web/app/api/classroom/route.ts',
  'apps/web/app/api/web-search/route.ts',
  'apps/web/app/api/pbl/chat/route.ts',
  'apps/web/app/api/parse-pdf/route.ts',
  'apps/web/app/api/generate-classroom/[jobId]/route.ts',
  'apps/web/app/api/generate-classroom/route.ts',
  'apps/web/app/api/classroom-media/[classroomId]/[...path]/route.ts',
];

let changed = 0;
for (const rel of files) {
  const file = path.resolve(rel);
  let content = fs.readFileSync(file, 'utf-8');
  const original = content;

  // Remove the shadowing const declaration line
  content = content.replace(/^\s*const backendUrl = backendUrl\(\);\s*\n/gm, '');
  
  // Now all remaining `${backendUrl}` template refs need to become `${backendUrl()}`
  // But be careful not to double-() if already correct
  content = content.replace(/\$\{backendUrl\}/g, '${backendUrl()}');

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf-8');
    console.log(`✓ ${rel}`);
    changed++;
  }
}
console.log(`\nDone. ${changed} files fixed.`);
