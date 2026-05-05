const fs = require('fs');
const path = require('path');

const walkSync = (dir, callback) => {
  const files = fs.readdirSync(dir);
  files.forEach((file) => {
    var filepath = path.join(dir, file);
    const stats = fs.statSync(filepath);
    if (stats.isDirectory() && !filepath.includes('node_modules') && !filepath.includes('.next')) {
      walkSync(filepath, callback);
    } else if (stats.isFile() && /\.(tsx|ts|jsx|js|css)$/.test(filepath)) {
      callback(filepath);
    }
  });
};

const regexes = [
  { search: /orange-/g, replace: 'emerald-' },
  { search: /amber-/g, replace: 'teal-' },
  { search: /#F97316/gi, replace: '#10B981' }
];

walkSync('apps/web', (filepath) => {
  let content = fs.readFileSync(filepath, 'utf8');
  let changed = false;
  
  regexes.forEach(({ search, replace }) => {
    if (search.test(content)) {
      // Create a global RegExp again because search.test advances the lastIndex
      const globalRegex = new RegExp(search.source, search.flags);
      content = content.replace(globalRegex, replace);
      changed = true;
    }
  });

  if (changed) {
    fs.writeFileSync(filepath, content, 'utf8');
    console.log(`Updated ${filepath}`);
  }
});
