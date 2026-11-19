import { createLogger, defineConfig, type Logger } from 'vite'
import react from '@vitejs/plugin-react'

// Vite's default proxy error includes the request URL and an exception object.
// Keep useful failure notification without exposing room paths or query strings.
export function privateProxyLogger(logger: Logger): Logger {
  return { ...logger, error(message, options) {
    if (message.includes('proxy error:') || message.includes('proxy socket error:')) {
      logger.error('API proxy connection failed. Check that the local API is running.', { timestamp: true })
    } else logger.error(message, options)
  } }
}

export default defineConfig({
  customLogger: privateProxyLogger(createLogger()),
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
})
