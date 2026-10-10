import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
const p = (s: string) => fileURLToPath(new URL(s, import.meta.url));
export default defineConfig({
  resolve: {
    alias: {
      '@merit/spec': p('./packages/spec/src/index.ts'),
      '@merit/capture': p('./packages/capture/src/index.ts'),
      '@merit/attest': p('./packages/attest/src/index.ts'),
      '@merit/verify': p('./packages/verify/src/index.ts'),
      opentimestamps: p('./packages/verify/node_modules/opentimestamps/index.js'),
    },
  },
  test: { include: ['packages/*/test/**/*.test.ts'] },
});
