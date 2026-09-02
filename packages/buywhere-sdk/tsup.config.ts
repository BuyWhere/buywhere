import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm', 'iife'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  minify: false,
  globalName: 'BuyWhereSDK',
  outExtension({ format }) {
    if (format === 'cjs') {
      return { js: '.cjs' };
    }

    if (format === 'esm') {
      return { js: '.js' };
    }

    return { js: '.global.js' };
  },
});
