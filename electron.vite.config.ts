import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['nanoid', 'p-limit', 'yocto-queue'] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared'),
        '@main': resolve(__dirname, 'electron/main')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['nanoid', 'p-limit', 'yocto-queue'] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'shared') }
    }
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'renderer'),
        '@shared': resolve(__dirname, 'shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'renderer/index.html') }
      }
    },
    server: { port: 5173 }
  }
})
