import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: '/aisup/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 8020,
    proxy: {
      '/api': 'http://localhost:8001'
    }
  }
})
