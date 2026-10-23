declare const __APP_VERSION__: string | undefined

/** 当前版本号：构建时从 electron-builder.yml 注入，与安装包文件名一致；未经 Vite 构建（如单元测试）时为 dev。 */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
