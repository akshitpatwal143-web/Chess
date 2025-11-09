import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy API requests to your backend server
      '/api': {
        target: 'https://chess-backend-88yn.onrender.com',
        changeOrigin: true,
        secure: false,
      },
    }
  }
})