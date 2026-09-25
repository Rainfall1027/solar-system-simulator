import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Keep the stable renderer cached when application logic changes.
        manualChunks(id) {
          if (id.includes('/node_modules/astronomy-engine/')) return 'ephemeris';
          if (id.includes('/node_modules/three/examples/')) return 'three-controls';
          if (id.includes('/node_modules/three/')) return 'three-core';
        }
      }
    }
  }
});
