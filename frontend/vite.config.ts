import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The development server proxies every /api request to the local Phase 2
// backend, so the frontend always calls the real declared routes and sees the
// current HTTP 501 response instead of any frontend substitute.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
