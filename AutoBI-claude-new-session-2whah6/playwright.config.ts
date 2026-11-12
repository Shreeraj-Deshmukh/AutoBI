import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  use: { baseURL: 'http://localhost:4173', trace: 'off', viewport: { width: 1440, height: 900 } },
  webServer: { command: 'npm run build && CELESTRA_AI_DISABLED=1 npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: true, timeout: 180_000 },
});
