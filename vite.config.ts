import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // `/` locally; GitHub Pages builds set BASE_PATH=/<repo>/ (see .github/workflows/build.yml).
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  // shown in the Claude panel's setup command (absolute path of mcp/server.mjs)
  define: { __NOTEHAND_DIR__: JSON.stringify(process.cwd().replace(/\\/g, '/')) },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // reference/ and claude/ are docs + ~100 MB of evidence; watching them is slow and can crash on locked files.
    watch: { ignored: ['**/reference/**', '**/claude/**', '**/.playwright-mcp/**', '**/public/fonts/**', '**/public/pages/**'] },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
} as never);
