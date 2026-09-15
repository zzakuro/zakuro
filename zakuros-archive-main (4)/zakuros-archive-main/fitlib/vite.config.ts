import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      // Long-lived vendor chunk: framework deps get a stable hash so repeat
      // visitors' caches survive app-code deploys (smaller re-downloads on push).
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/scheduler')) return 'vendor-react';
            if (id.includes('node_modules/react-router') || id.includes('node_modules/react-router-dom')) return 'vendor-router';
            if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) return 'vendor-motion';
            if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
            if (id.includes('node_modules/') && /react-router|history|remix-run|@remix-run/.test(id)) return 'vendor-router';
            return undefined;
          },
        },
      },
    },
  };
});
