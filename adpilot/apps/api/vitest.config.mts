import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required to emit decorator metadata for NestJS dependency injection in tests.
// Inline projects extend this file, so they inherit the plugin.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    globals: false,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['test/unit/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.spec.ts'],
          globalSetup: ['test/support/global-setup.ts'],
          setupFiles: ['test/support/setup-env.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/e2e/**/*.spec.ts'],
          globalSetup: ['test/support/global-setup.ts'],
          setupFiles: ['test/support/setup-env.ts'],
          fileParallelism: false,
          testTimeout: 300_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
