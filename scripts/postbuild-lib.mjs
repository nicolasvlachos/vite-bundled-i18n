import fs from 'node:fs';
import path from 'node:path';

// Add shebang to CLI entry
const cliPath = path.resolve('dist/cli/index.js');
if (fs.existsSync(cliPath)) {
  const source = fs.readFileSync(cliPath, 'utf8');
  const shebang = '#!/usr/bin/env node\n';
  if (!source.startsWith(shebang)) {
    fs.writeFileSync(cliPath, `${shebang}${source}`);
  }
}

// Replace generated types with empty stubs for publishing.
// Consumers override via tsconfig paths: "vite-bundled-i18n/generated" → their generated file.
const generatedDts = path.resolve('dist/core/i18n-generated.d.ts');
if (fs.existsSync(generatedDts)) {
  fs.writeFileSync(generatedDts, [
    '// Empty stubs — consumers generate their own via the vite-bundled-i18n plugin.',
    '// Override with tsconfig paths: "vite-bundled-i18n/generated": ["./path/to/generated"]',
    'export interface I18nNestedKeys {}',
    'export interface I18nParamsMap {}',
    'export interface I18nScopeMap {}',
    '',
  ].join('\n'));
}

