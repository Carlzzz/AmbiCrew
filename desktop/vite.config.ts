import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const tauriStubs = (name: string) =>
  path.resolve(__dirname, `src/tauri-stubs/${name}.ts`)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    alias: {
      '@tauri-apps/api/core': tauriStubs('core'),
      '@tauri-apps/api/event': tauriStubs('event'),
      '@tauri-apps/api/window': tauriStubs('window'),
      '@tauri-apps/api/app': tauriStubs('app'),
      '@tauri-apps/plugin-shell': tauriStubs('shell'),
      '@tauri-apps/plugin-dialog': tauriStubs('dialog'),
      '@tauri-apps/plugin-notification': tauriStubs('notification'),
      '@tauri-apps/plugin-process': tauriStubs('process'),
      '@tauri-apps/plugin-updater': tauriStubs('updater'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
})
