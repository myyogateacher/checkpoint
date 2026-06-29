import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  server: {    
    port: Number(process.env.PORT) || 3000,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
