# 本地存储兼容

运行 `start-local.cmd` 后访问 http://127.0.0.1:5173/ 。

支持 IndexedDB 的浏览器沿用原数据库。内置浏览器出现 `UnknownError: Internal error opening backing store` 时，自动启用兼容数据库并通过本地服务将项目、章节、角色、镜头和素材保存到 `local-data/database.json`。API Key 仍保存在原浏览器配置中，不写入该项目文件。

本地服务只监听 127.0.0.1，禁止跨站写入，采用临时文件和重命名保存数据。请保留 local-data 目录；它已加入 Git 忽略。兼容存储模式同时使用多个标签进行编辑可能覆盖彼此修改，请在一个标签中操作。

开发模式 `npm run dev` 与普通 Vite preview 不提供本地文件 API。需要此兼容模式时，先运行 `npm run build`，然后运行 `node scripts/serve-local.mjs`。
