import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mockApi } from './mock/plugin.ts';

export default defineConfig({
  plugins: [react(), tailwindcss(), ...(process.env.MOCK ? [mockApi()] : [])],
  server: {
    host: '127.0.0.1',
    proxy: { '/api': 'http://localhost:8080', '/health': 'http://localhost:8080' },
  },
  build: { outDir: 'dist', target: 'es2022' },
});
