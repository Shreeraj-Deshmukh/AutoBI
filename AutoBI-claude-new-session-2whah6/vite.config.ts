/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { azureFoundryPlugin } from './server/azureFoundry.js';

export default defineConfig(({ mode }) => {
  // Load all env vars (not only VITE_*) for the server-side Azure AI Foundry proxy.
  // They are never exposed to the browser bundle.
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  return {
    plugins: [react(), azureFoundryPlugin(env)],
    base: './',
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    build: { chunkSizeWarningLimit: 2500 },
    test: { globals: true, environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
  };
});
