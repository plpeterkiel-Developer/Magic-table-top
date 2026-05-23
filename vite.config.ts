import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite is our dev server and bundler. It serves the React app at http://localhost:5173
// during development and produces a static build for deployment.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // expose on the LAN so a phone on the same Wi-Fi can hit dev
  },
});
