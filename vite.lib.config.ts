import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const entries = {
  index: path.resolve(__dirname, 'src/index.ts'),
  react: path.resolve(__dirname, 'src/react.ts'),
  vanilla: path.resolve(__dirname, 'src/vanilla.ts'),
  vue: path.resolve(__dirname, 'src/vue.ts'),
  server: path.resolve(__dirname, 'src/server-entry.ts'),
  plugin: path.resolve(__dirname, 'src/plugin.ts'),
  'cli/index': path.resolve(__dirname, 'src/cli/index.ts'),
};

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'),
) as { version: string };

export default defineConfig({
  publicDir: false,
  define: {
    __VITE_BUNDLED_I18N_VERSION__: JSON.stringify(pkg.version),
  },
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      'vite-bundled-i18n/generated': path.resolve(__dirname, 'src/core/i18n-generated.ts'),
    },
  },
  build: {
    emptyOutDir: true,
    lib: {
      entry: entries,
      formats: ['es'],
    },
    minify: false,
    sourcemap: true,
    target: 'es2023',
    outDir: 'dist',
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'vue',
        'vite',
        'typescript',
        'tinyglobby',
        /^node:/,
      ],
      output: {
        entryFileNames: (chunkInfo) => `${chunkInfo.name}.js`,
      },
    },
  },
});
