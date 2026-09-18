import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: __dirname,
  // Relative asset paths -- required for the built index.html to load
  // correctly under Electron's file:// protocol via loadFile(). Without
  // this, Vite emits absolute "/assets/..." paths that resolve against the
  // filesystem root instead of the app's own directory, and the window
  // loads blank.
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
