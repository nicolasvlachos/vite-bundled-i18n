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

export default defineConfig({
  publicDir: false,
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
