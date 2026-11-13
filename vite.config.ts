import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 只用到 env（避免为了一个环境变量引入 @types/node）
declare const process: { env: Record<string, string | undefined> }

// NOTE: 本项目所在的磁盘分区可能是 exFAT（不支持硬链接 / 原生文件事件），
// 因此开启 polling 形式的文件监听，保证 dev server 的热更新在这些分区上也能工作。
export default defineConfig({
  plugins: [react()],
  server: {
    // 默认 0.0.0.0：手机/平板可直接连 5274 调试；只给本机用 MS_HOST=127.0.0.1
    host: process.env.MS_HOST || '0.0.0.0',
    port: Number(process.env.MS_PORT || 5274),
    strictPort: true,
    watch: { usePolling: true, interval: 300 },
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
})
