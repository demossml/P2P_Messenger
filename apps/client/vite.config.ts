import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@p2p/crypto': fileURLToPath(new URL('../../packages/crypto/src/index.ts', import.meta.url)),
      '@p2p/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@p2p/webrtc': fileURLToPath(new URL('../../packages/webrtc/src/index.ts', import.meta.url))
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173
  },
  preview: {
    host: '127.0.0.1',
    port: 4173
  }
});
