import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` produces ONE self-contained file: dist/index.html.
// It can be opened by double-clicking, copied to a shared drive, or hosted on any web server.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  worker: { format: 'es' },
});
