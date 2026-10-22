# AI 短剧生产台 1.1.0：复用与来源

2026-10-17 实际检索、读取源码与许可证后的选型。没有执行研究仓库的安装脚本。

| 项目 | 固定版本 / 许可证 | 采用情况与实际用途 |
| --- | --- | --- |
| [dramai](https://github.com/hyyyyyyz/dramai) | 基础工程已有 Apache-2.0，保留 LICENSE/NOTICE | 延用 React、Dexie、模型适配器与素材管理，加入持久化自动任务调度和独立制作预设 |
| [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) | @ffmpeg/ffmpeg 0.12.15（MIT）；@ffmpeg/core 0.12.6（编译 FFmpeg 的 GPL 组件，按原组件许可证） | 延用随包分发的核心，新增旁白替换、对白超长拦截、响度与峰值控制、横竖屏输出。实际视频编码及播放验证，不依赖剪映 |
| [ZenStory](https://github.com/zenstory-ai/zenstory/tree/adf8629b4f63d3cdc8251c4868a42263ec7e4555) | adf8629b4f63d3cdc8251c4868a42263ec7e4555，MIT，源码已下载阅读 | 采用 apps/server/prompts/templates/web_short/chapter_generation.j2 的“行动与细节”段落，保存为 src/core/prompts/vendor/zenstory-action.txt 并实际注入小说生成请求。许可证随安装包保存于 THIRD_PARTY/zenstory.LICENSE。未引入其服务端和数据库 |
| [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft/tree/1e228479dda361e312e85f6037002346cf6dca9a) | 0.3.1，1e228479dda361e312e85f6037002346cf6dca9a，Apache-2.0，2026-10-14 提交 | 已读取 script_file.py、segment.py、模板与 setup.py。依赖 Python、pymediainfo、imageio、Windows uiautomation，且草稿兼容性受剪映版本影响。本机未找到可验证的剪映安装，不把 JSON 素材清单冒充原生草稿。本版保留可编辑时间线与素材导出，暂不分发该库 |
| [diffusionstudio/core](https://github.com/diffusionstudio/core) | 仓库公开许可证包含商业使用、再分发限制 | 未采用，避免为现有 FFmpeg 合成引入许可与运行时负担 |

## 本地 Skill 的程序化接入

- write-romance-fiction：人物目标与主动选择、爽点的铺垫与代价、感情递进、作家修订。
- novel-to-storyboard：静态首帧与运动 Prompt 分离、空间/视线/道具连续性、入出状态、具体剪辑接点。
- romance-to-drama：先保存小说定稿，再根据该版本改编；SHA-256 来源指纹；小说改动使派生产物失效。

这些规则已转成 src/core/prompts/production-skills.ts、directing.ts 的实际提示词与结构校验，以及 runner.ts 的版本与任务流程。安装版无需安装 Codex 或这些 Skill。没有把外部 Skill 中的工具操作指令作为程序权限。

## 运行与验证边界

- 支持新上传项目自动制作选中章；多章文件默认第一章，专业模式可先选择其他章。本版不是整部长篇批量分集生产系统。
- 视频接口能力采用已实现适配器的保守范围，不以供应商的全部能力作为本程序承诺。参考图仅向明确支持的模型发送；文字设定不能保证视觉身份绝对一致。
- 后期旁白采用独立 OpenAI 兼容 Speech 服务；没配置时前置拦截。原声模式不会凭空产生对白。配乐、多音色对白与口型同步尚未接入。
- 暂停/取消停止本地后续执行，不能撤销服务商已受理任务；句柄保留，继续时查询原任务。未知结果的提交需明确确认重试。
- 生成请求次数上限不是人民币预算，不能精确预测供应商收费。串行提交限制并发为1，轮询连接最多连续重试3次，文本结构校验失败最多自动修复1次，每次计入请求上限，没有无限生成重试。
- 重启后可从当前项目继续；提交时断电、没有拿到任务句柄的请求需核对服务商记录。
- 技术检查确认时间线、轨道、时长和字幕结构；观感提醒指出需要检查的位置，不声称自动识别人物、口型或艺术质量。
- 测试报告分别标明协议桩、真实文本服务和既有真实视频素材回归，不能混称全模型实测。
