import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  // HTTPS(自己署名): LAN 共有と secure context 必須 API（randomUUID / 将来の getUserMedia）のため
  plugins: [react(), tailwindcss(), basicSsl()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // LAN の他デバイスからアクセス可能にする（アクセス可否は backend のオーナー承認で制御）
    host: true,
    proxy: {
      // xfwd: X-Forwarded-For を付与する。backend はこれで「オーナー(localhost)か否か」を判定する
      '/api': {
        target: 'http://localhost:8080',
        xfwd: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
        xfwd: true,
      },
    },
  },
})
