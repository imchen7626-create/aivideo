import {defineConfig} from 'vite'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({base:'/',plugins:[react(),tailwindcss()],resolve:{alias:{'@':path.resolve('src')}},build:{target:'es2022',outDir:'work/composition-test/dist',emptyOutDir:true,rollupOptions:{input:[path.resolve('tests/fixtures/composition.html'),path.resolve('tests/fixtures/pipeline-ui.html'),path.resolve('tests/fixtures/automation.html'),path.resolve('tests/fixtures/live-text.html'),path.resolve('tests/fixtures/settings.html'),path.resolve('tests/fixtures/restart.html')]}}})
