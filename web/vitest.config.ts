import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    // Run test files sequentially to avoid EADDRINUSE from
    // server/index.ts calling app.listen() on import
    fileParallelism: false,
    // Component tests (tests/components/) use jsdom environment
    // via @vitest-environment jsdom comment in each file
  },
});
