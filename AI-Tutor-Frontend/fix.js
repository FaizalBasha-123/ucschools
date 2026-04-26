const fs = require('fs');
const path = require('path');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            if (!file.includes('node_modules') && !file.includes('.next') && !file.includes('dist') && !file.includes('.git')) {
                results = results.concat(walk(file));
            }
        } else { 
            if (file.endsWith('.tsx') || file.endsWith('.ts') || file.endsWith('.css')) {
                results.push(file);
            }
        }
    });
    return results;
}

const files = walk('apps/web');
let count = 0;
files.forEach(file => {
    try {
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes('slate-')) {
            const newContent = content.replace(/slate-/g, 'neutral-');
            fs.writeFileSync(file, newContent, 'utf8');
            count++;
        }
    } catch(e) {}
});
console.log('Replaced in ' + count + ' files');
