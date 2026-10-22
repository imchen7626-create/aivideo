# 阿里云百炼自动生图与视频

## 阿里云业务空间专属域名

如果配置的是 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，本地服务会将图片请求转发到同一业务空间，避免浏览器跨域拦截。视频自动使用同一业务空间的 DashScope 异步接口，任务查询和结果下载也走本地服务；不会将 Key 转到其他业务空间。请使用本地启动器运行，修改服务端代码后需重启服务。

已知显示名称 `千问-图片生成大模型`、`千问图片编辑` 解析为 `qwen-image-2.1-turbo`；`wan3` 解析为 `wan3.0-video`，设置卡显示实际 API 模型 ID。直接填写其他正式 API ID 时保留原值。万相 3.0 使用 `input.media` 中的 `first_frame` 输入，720P、每镜 5 秒。2026-10-14 已使用用户配置完成真实图片和单镜视频生成、下载及本机保存验证。

生成队列最多三镜并行；已有图片或视频会跳过，未完成的视频按已保存任务编号继续查询。成片使用本地 FFmpeg 核心，输出 720×1280 竖屏并保留音轨。

官方协议参考：
- https://www.alibabacloud.com/help/zh/model-studio/qwen-image-generation-and-editing-api-reference
- https://help.aliyun.com/zh/model-studio/wan3-video-generation-guide

## 固定北京地域的官方转发

当前接入官方北京地域接口，本地服务仅转发到阿里云并下载生成结果。API Key 在项目设置中填写，不经过 302.AI。静态托管（如 GitHub Pages）不提供此本地转发服务。

1. 运行 `npm run build`，然后使用项目的本地启动器。若旧服务正在运行，先关闭旧服务再启动。开发模式 `npm run dev` 同样支持。
2. 设置 → 添加服务商 → “添加百炼生图”：填写北京地域的百炼通用 API Key，保存并激活。
3. 再添加“百炼视频”，填写同一个 Key，保存并激活。不要使用 Coding Plan / Token Plan 专属 Key。
4. 测试连接只确认本地转发服务可用，不会消耗生成额度，也不验证模型权限。
5. 先单独生成一张图和一段 5 秒视频，成功后使用工作台批量生成。

默认文生图 `z-image-turbo`：720×1280，关闭提示词改写，约 0.10 元/张。只支持文字，不支持锁定角色参考图；有参考图时会明确报错，不会悄悄忽略。提示词最长 800 字符。

默认视频 `wan2.2-i2v-flash`：720P、固定 5 秒，无声，约 0.20 元/秒。12 镜（60 秒）的图片与视频约 13.2 元，不含文字脚本、重试或重新生成。免费额度优先抵扣，实际费用、额度和有效期以控制台为准。少量付费可先充值小额余额并设置账单提醒。

视频任务成功提交后保存编号及服务商信息。中止等待、刷新、查询失败或下载失败后，再点击“继续查询视频”会查询原任务；不会再次提交。查询连接异常最多连续重试三次。服务商或模型改变时阻止查询，避免把旧任务发往新账号。

生成 POST 请求不会自动重试。若在返回任务编号之前断网，无法确认服务端是否受理，必须先在百炼控制台核实后再手动提交；这类情况不能保证零重复费用。视频任务查询/下载链接有有效期，过期任务请到控制台处理。

接入已提供协议模拟测试；尚需用户账号完成真实生图/视频验证。

官方参考：
- https://help.aliyun.com/zh/model-studio/z-image-api-reference
- https://help.aliyun.com/zh/model-studio/legacy-image-to-video-api-reference/
- https://help.aliyun.com/zh/model-studio/model-pricing
- https://help.aliyun.com/zh/model-studio/new-free-quota
