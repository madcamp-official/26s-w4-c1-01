import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// WebView 임베드를 전제로 상대 경로 base 사용 (Android asset:// 등)
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true, port: 5173 },
})
