import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

import pkg from './package.json'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // @noble/hashes exports use ".js" suffixes that Vite 8 doesn't auto-resolve.
      '@noble/hashes/hmac': path.resolve(__dirname, 'node_modules/@noble/hashes/hmac.js'),
      '@noble/hashes/sha256': path.resolve(__dirname, 'node_modules/@noble/hashes/sha2.js'),
      '@noble/hashes/sha2': path.resolve(__dirname, 'node_modules/@noble/hashes/sha2.js'),
      '@noble/hashes/utils': path.resolve(__dirname, 'node_modules/@noble/hashes/utils.js'),
      '@noble/hashes/hkdf': path.resolve(__dirname, 'node_modules/@noble/hashes/hkdf.js'),
      '@noble/hashes/sha3': path.resolve(__dirname, 'node_modules/@noble/hashes/sha3.js'),
      '@noble/curves/secp256k1': path.resolve(__dirname, 'node_modules/@noble/curves/secp256k1.js'),
      '@scure/bip39/wordlists/english': path.resolve(__dirname, 'node_modules/@scure/bip39/wordlists/english.js'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
})
