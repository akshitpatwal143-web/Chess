import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy API requests to your backend server
      '/api': {
        target: 'http://192.168.1.171:3001',
        changeOrigin: true,
        secure: false,
      },
    }
  }
})