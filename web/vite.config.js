import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// WebView 임베드를 전제로 상대 경로 base 사용 (Android asset:// 등)
export default defineConfig({
  base: './',
  plugins: [react()],
  // 개발 시 /api 호출을 백엔드(:8000)로 프록시 → npm run dev + 백엔드만 켜면 바로 붙음
  server: { host: true, port: 5173, proxy: { '/api': 'http://localhost:8000' } },
})
