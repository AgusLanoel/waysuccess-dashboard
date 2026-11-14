import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Librerías en bloques aparte (se cachean entre despliegues y ningún bloque pasa de 500 kB)
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) return 'graficos'
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('react')) return 'react'
          return 'libs'
        },
      },
    },
  },
})
