import * as esbuild from 'esbuild';

const isProduction = process.argv.includes('--production');
const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode', '@vscode/ripgrep'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !isProduction,
  minify: isProduction,
  treeShaking: true,
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('[search++] Watching for changes...');
} else {
  await esbuild.build(buildOptions);
  console.log('[search++] Build complete.');
}
