import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // The LiveKit WebRTC runtime is intentionally isolated in its own lazy
    // chunk. Its minified size is just above Vite's generic 500 kB warning.
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        manualChunks: {
          "livekit-client": ["livekit-client"],
          "livekit-components": ["@livekit/components-react", "@livekit/components-styles"],
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
});
