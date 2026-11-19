import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In development the API runs separately (npm run dev:server).
    proxy: { '/api': 'http://localhost:3000' },
  },
});
