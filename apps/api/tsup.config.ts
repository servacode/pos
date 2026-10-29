import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/scripts/seed.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source, so they are bundled; npm dependencies stay external.
  noExternal: [/^@serva\//],
});
