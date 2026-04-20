import fs from 'node:fs';
import path from 'node:path';

const cliPath = path.resolve('dist/cli/index.js');

if (fs.existsSync(cliPath)) {
  const source = fs.readFileSync(cliPath, 'utf8');
  const shebang = '#!/usr/bin/env node\n';
  if (!source.startsWith(shebang)) {
    fs.writeFileSync(cliPath, `${shebang}${source}`);
  }
}
