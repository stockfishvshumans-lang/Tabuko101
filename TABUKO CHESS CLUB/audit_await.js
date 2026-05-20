const fs = require('fs');
const path = require('path');

function auditFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let inAsync = false;
    let stack = [];
    let errors = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check for function starts
        if (line.match(/async\s+function/) || line.match(/async\s*\(/) || line.match(/async\s+[\w]+\s*=>/)) {
            stack.push(true);
        } else if (line.match(/function/) || line.match(/\(/) || line.match(/[\w]+\s*=>/)) {
            if (line.includes('{')) {
                stack.push(false);
            }
        }

        if (line.includes('await')) {
            const isInsideAsync = stack.some(s => s === true);
            if (!isInsideAsync) {
                errors.push(`Line ${i + 1}: ${line.trim()}`);
            }
        }

        // Pop stack on closing brace (very naive)
        const openCount = (line.match(/\{/g) || []).length;
        const closeCount = (line.match(/\}/g) || []).length;
        for (let k = 0; k < closeCount - openCount; k++) {
            stack.pop();
        }
    }
    return errors;
}

const jsDir = './js';
fs.readdirSync(jsDir).forEach(file => {
    if (file.endsWith('.js')) {
        const errors = auditFile(path.join(jsDir, file));
        if (errors.length > 0) {
            console.log(`ERRORS IN ${file}:`);
            errors.forEach(e => console.log(e));
        }
    }
});
