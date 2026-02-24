import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5199,
    strictPort: true,
  },
  ssr: {
    noExternal: ['@touchgrass/avatar']
  },
})
