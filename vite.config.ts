import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { handleBailian } from './scripts/bailian-proxy.mjs'
import { handleWorkspace } from './scripts/aliyun-workspace-proxy.mjs'

// GitHub Pages 部署在 https://hyyyyyyz.github.io/dramai/
// 因此默认 base = "/dramai/"。本地或自托管时可用 VITE_BASE 覆盖。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE ?? '/'

  return {
    base,
    plugins: [react(), tailwindcss(), {
      name: 'bailian-local-proxy',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          handleBailian(req, res).then(async handled => { if (!handled && !(await handleWorkspace(req,res))) next() }).catch(next)
        })
      },
    }],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      open: false,
    },
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  }
})
