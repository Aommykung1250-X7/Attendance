import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// พอร์ตตั้งที่ .env ที่เดียว ไม่มีพอร์ตไหน hardcode ในโค้ด
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.PORT_FRONTEND || 5290)
  const backend = Number(env.PORT_BACKEND || 5292)
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port,
      strictPort: true,
      // /api ส่งต่อไป backend ทำให้ cookie อยู่โดเมนเดียวกันเหมือนตอนขึ้นจริงหลัง nginx
      proxy: { '/api': { target: `http://127.0.0.1:${backend}`, changeOrigin: false } },
    },
    preview: { port: port + 1, strictPort: true },
  }
})
