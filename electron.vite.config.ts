import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // Chiave "main" → output: out/main/main.js (allineato con "main" in package.json)
        input: { main: resolve(__dirname, 'src/main/main.ts') },
        // electron must not be bundled: its CJS index.js uses __dirname to locate path.txt
        // Native modules must not be bundled: bindings resolves .node files relative to __dirname
        external: ['electron', /^electron\/.+/, 'better-sqlite3', 'koffi']
      }
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // electron must not be bundled in preload either
        external: ['electron', /^electron\/.+/],
        // Preload with sandbox:true requires CJS (ESM not supported in sandboxed context)
        output: { format: 'cjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  }
})
