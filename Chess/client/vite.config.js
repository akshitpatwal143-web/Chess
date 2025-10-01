import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy API requests to your backend server
      '/api': {
        target: 'http://10.138.129.227:3001', // ✅ CORRECT IP ADDRESS
        changeOrigin: true,
        secure: false,
      },
    }
  }
})