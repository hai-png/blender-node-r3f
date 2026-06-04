/**
 * tsup — library build configuration.
 *
 * Produces two entry points, both as ESM + CJS with full .d.ts declarations:
 *
 *   dist/index.{esm,cjs}.{js,d.ts}    — main public API
 *   dist/tsl.{esm,cjs}.{js,d.ts}      — TSL / WebGPU sub-entry (imports three/webgpu)
 *   dist/bridge.{esm,cjs}.{js,d.ts}   — Blender bridge sub-entry
 *
 * Peer dependencies (three, react, @xyflow/react, zustand) are NOT bundled
 * so consumers bring their own versions.
 *
 * Usage:
 *   npm run build:lib           → lib only
 *   npm run build               → typecheck + lib + demo
 */
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    tsl: 'src/tsl.ts',
    bridge: 'src/bridge.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  // External: don't bundle any peer dependencies.
  external: [
    'three',
    'three/tsl',
    'three/webgpu',
    'react',
    'react-dom',
    '@react-three/fiber',
    '@react-three/drei',
    '@xyflow/react',
    'zustand',
    'zod',
    'nanoid',
  ],
  // Ensure .d.ts refs to three/tsl and three/webgpu use the installed types.
  treeshake: true,
  splitting: false,
  // Keep class names for registry lookups.
  minify: false,
  target: 'es2022',
});
