import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { handleBailian } from './scripts/bailian-proxy.mjs'
import { handleWorkspace } from './scripts/aliyun-workspace-proxy.mjs'

// GitHub Pages 部署在 https://hyyyyyyz.github.io/dramai/
// 因此默认 base = "/dramai/"。本地或自托管时可用 VITE_BASE 覆盖。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = env.VITE_BASE ?? '/'
  // 版本号只在 electron-builder.yml 维护一处，界面显示与安装包版本保持一致。
  const appVersion =
    /^\s+version:\s*([\w.-]+)\s*$/m.exec(readFileSync(path.resolve(__dirname, 'electron-builder.yml'), 'utf8'))?.[1] ??
    'dev'

  return {
    base,
    define: { __APP_VERSION__: JSON.stringify(appVersion) },
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
