import { resolve } from 'node:path';
import builtins from 'builtin-modules';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const entry = 'src/main.ts';

export default defineConfig(({ mode }) => {
  const prod = mode === 'production';

  return {
    plugins: [
      viteStaticCopy({ targets: [{ src: 'public/*', dest: '.' }] }),
    ],
    resolve: {
      alias: {
        '@': resolve(process.cwd(), './src'),
      },
    },
    build: {
      lib: {
        entry: resolve(process.cwd(), entry),
        name: 'main',
        fileName: () => 'main.js',
        formats: ['cjs'],
      },
      minify: prod,
      sourcemap: prod ? false : 'inline',
      cssCodeSplit: false,
      // The build dir is a symlink into the vault and holds data.json + .hotreload.
      // Never empty it.
      emptyOutDir: false,
      outDir: 'build',
      rollupOptions: {
        input: {
          main: resolve(process.cwd(), entry),
        },
        output: {
          entryFileNames: 'main.js',
          assetFileNames: (assetInfo) => {
            if (assetInfo.name === 'styles.css') return 'styles.css';
            if (assetInfo.name === 'manifest.json') return 'manifest.json';
            return '[name][extname]';
          },
        },
        external: [
          'obsidian',
          'electron',
          '@codemirror/autocomplete',
          '@codemirror/collab',
          '@codemirror/commands',
          '@codemirror/language',
          '@codemirror/lint',
          '@codemirror/search',
          '@codemirror/state',
          '@codemirror/view',
          '@lezer/common',
          '@lezer/highlight',
          '@lezer/lr',
          ...builtins,
        ],
      },
    },
  };
});
