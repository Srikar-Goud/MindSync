import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three-vendor';
          if (id.includes('/node_modules/@react-three/fiber/')
            || id.includes('/node_modules/react-reconciler/')
            || id.includes('/node_modules/zustand/')
            || id.includes('/node_modules/its-fine/')
            || id.includes('/node_modules/suspend-react/')) return 'fiber-vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:8787',
        ws: true,
      },
    },
  },
});
