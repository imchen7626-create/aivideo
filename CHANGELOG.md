# Changelog

All notable changes to dramai are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [AI 短剧生产台 1.7.3] - 2026-10-23

### Fixed
- 主观镜头（望远镜、门缝、手机等视野）里不再出现观看者本人：分镜标注观看者（pov_of），出图时不给他的定妆照，也不参考上一镜画面；画面里的其他角色照常参考。
- 首帧写明“无人物”的空镜不再传角色定妆照，避免把人画进景物镜头。
- 人脸更自然：选角不再写晒红、腮红等会被画成色块并在每镜重复的面部细节；定妆照与每镜出图禁止夸张腮红、红色色块和塑料感皮肤；每镜的姿势、朝向和表情严格按本镜描述，不再照搬定妆照的正面摆拍。

## [AI 短剧生产台 1.7.2] - 2026-10-23

### Added
- 生产台标题旁显示当前版本号；设置等页面的页头也改为显示真实版本（原来写死为 v0.4.1）。版本号构建时取自 electron-builder.yml，与安装包一致。

## [AI 短剧生产台 1.7.1] - 2026-10-23

### Fixed
- 配音时百炼或网关返回非 JSON 的错误（如业务空间不支持情感配音模型时的纯文本 404、网关 5xx 网页）不再被误报为“本地百炼服务未启动”：业务空间→官方接口、情感配音→普通配音的回退照常进行，网关 5xx 自动重试，报错写出真实状态码与内容。

## [AI 短剧生产台 1.7.0] - 2026-10-23

### Changed（剧情与画面连贯）
- 分镜里每镜的起始/结束状态真正用于生成：首帧只画动作开始前的那一瞬间，视频收在结束状态上，下一镜从这里接。
- 同一场次切换机位时，以上一镜首帧作为参考图出首帧，人物站位、道具状态与光线保持一致（只等首帧，视频仍并行生成）。
- 剪辑配平优先剪掉镜头开头的静止起势，保留结尾的动作落点与剪辑点。
- HappyHorse、wan2.7 按镜头实际需要生成 3–8 秒素材，少剪甚至不剪，也更省费用。
- 导演规则：按顺序覆盖全部剧情节拍（钩子必须在第一镜），相邻镜头首尾状态相接，首帧不得包含时间顺序；旁白/字幕补充画面看不出的因果与关键台词，不复述画面。
- 老版 wan 视频模型关闭提示词智能改写，按分镜拍，不再自行加戏。

## [AI 短剧生产台 1.6.6] - 2026-10-23

### Fixed
- 视频任务失败后，镜头上的任务号没有被清除，导致每次“继续制作”都在反复查询同一个已失败的旧任务、从不重新提交（计数也不变）。现在失败会先清除任务号再报错。
- 上次遗留的旧任务若因首帧格式被拒，继续制作时会在同一次运行中按当前格式重新提交一次（计入提交次数），不用点两次。

## [AI 短剧生产台 1.6.5] - 2026-10-23

### Fixed
- 视频任务先被受理、处理时才因首帧格式失败（如“Field required: input.media”）时，也会记住正确格式并提示；点“继续制作”即按新格式重新提交。

## [AI 短剧生产台 1.6.4] - 2026-10-23

### Fixed
- 图生视频首帧格式不再只认个别模型：wan2.7 也按官方新格式（input.media）提交，口型同步时配音作为 driving_audio 传入，480P 自动按 720P 生成。
- 接口因首帧字段格式拒收（如“Field required: input.media”）时，自动换另一种格式重发一次，并记住该模型的格式；其他错误不重发，两种格式都被拒时直接报错，不会反复提交。

## [AI 短剧生产台 1.6.3] - 2026-10-23

### Fixed
- 百炼工作区的 HappyHorse 图生视频（happyhorse-1.1-i2v）按官方格式提交首帧（input.media），并关闭默认水印，修复“Field required: input.media”。

## [AI 短剧生产台 1.6.2] - 2026-10-23

### Fixed
- 只填了域名、缺少 https:// 的接口地址会自动补全（含已保存的设置），百炼工作区地址不再被误判而走错接入方式。
- 图生视频填了文生视频（t2v）模型，或“百炼”协议走本地接入却用了 wan2.2-i2v-flash 以外的模型时，设置页与生产前检查会直接提示，不再提交后才报错。
- 桌面版“复制诊断”“复制文案”可以正常写入剪贴板。

## [AI 短剧生产台 1.6.1] - 2026-10-21

### Changed
- 模型配置统一到“设置 → AI 服务商”：配音模型放在“语音合成”下，角色一致性出图模型放在“文生图”下，口型同步视频模型放在“图生视频”下，均支持自定义模型 ID。
- “声音”区只保留创作选项（声音方式、角色音色、口型同步开关、背景音乐），显示当前配音模型并可一键跳转设置。
- 旧版本写在生产预设里的模型选择会在升级时自动迁移到设置。
- 单独添加的语音服务以该服务自己的模型为准；自动复用百炼 Key 时使用设置里选的配音模型。

## [AI 短剧生产台 1.6.0] - 2026-10-21

### Added
- 口型同步：角色对白镜头先生成配音，再用 wan2.6-i2v-flash 以“首帧 + 台词音频”驱动生成视频，嘴型跟随台词；账号未开通或失败时自动回退普通视频模型并在完成信息里提示。
- 背景音乐：“声音”区可选择本地音乐文件并调节音量，成片自动循环铺底、对白处自动压低（ducking），结尾 2 秒淡出。
- 配音模型配置入口：“声音”区新增“配音模型”下拉（自动 / qwen3-tts-instruct-flash / qwen3-tts-flash / qwen-tts / 自定义模型 ID），设置页新增百炼 Qwen-TTS 预设。

### Fixed
- 音视频上传改为百炼临时存储（oss://），避免大文件 data URI 被拒。

## [AI 短剧生产台 1.5.0] - 2026-10-20

### Added
- 角色对白配音（新默认声音模式）：人物自己说台词，每镜最多一句，说话人为登记角色、“内心”（第一人称独白，全片≤2句）或“旁白”（仅钩子/时间跳跃，≤1句）。
- 分角色音色：选角时识别性别与年龄段，自动分配互不相同的 Qwen-TTS 音色；定妆照下可逐个修改。
- 情感表演：分镜为每句台词写表演指示（情绪、语气、语速），优先用 qwen3-tts-instruct-flash 情感配音，账号不支持时自动回退普通模型。
- 对白场面按正反打设计：说话人正脸时视频提示词要求自然开口；长台词放在过肩/反应镜头（L-cut）；视频画面不生成人声，只留环境声。
- 环境声垫底：配音模式下保留视频原声并压低到约 -16dB 垫在台词下，无台词镜头同样压低，整片声音一致不“干”。
- 分镜编辑可改说话人、台词、表演指示，只重配该镜声音。

### Changed
- “解说旁白”保留为可选模式，适合解说类视频；“自动”默认改为角色对白。

## [AI 短剧生产台 1.4.0] - 2026-10-20

### Added
- 场景短片：输入一个场景描述，生成单一场景、时间连续的 15 秒（可选 15–120 秒）短片，镜头以“上一镜尾帧接下一镜首帧”串联。
- 成片时长 15/30/60/90/120 秒，分辨率 480P/720P/1080P（传给万相/即梦视频，成片输出 540×960 / 720×1280 / 1080×1920）。
- 专业分镜：先分场次再分镜，输出 scenes（地点、光线、站位）与每镜 scene_id、景别、衔接方式；建立镜→中景→近景/特写→反应的覆盖逻辑，180 度轴线、视线、景别变化与动作匹配剪辑规则。
- 场次定场图：每个场次生成一张无人空镜，与角色定妆照一起作为每镜首帧参考，统一环境、光线与色调。
- 连续镜头：continuous 镜头直接取上一镜视频最后一帧作为首帧，无需再出图；时长求解器让链中镜头用满素材、在尾帧处切，实现无缝衔接；独立镜头链并行生成。

### Changed
- 剪辑：统一调色与轻锐化、铺满画幅裁切（不再加黑边）、跳过 AI 片段起始 0.24 秒静止段、场次切换处 0.25 秒黑场过渡。
- 新作品设置（时长/分辨率/画幅）始终可改，不再被已选项目锁定；运行期设置（并发、上限、一致性、配音）同步到当前项目。
- 视频提示词不再强行附加“固定机位”，并统一追加人物一致、动作克制、无文字等约束。

## [AI 短剧生产台 1.3.2] - 2026-10-19

### Fixed
- 旁白已生成但下载失败（HTTP 400）：Qwen-TTS 返回的是 http:// 的 OSS 链接，本地转发只接受 https，被判为不支持的地址。现在接受 http 并自动升级为 https 下载，并放宽到阿里云 OSS 结果桶域名；下载失败时显示转发服务给出的原因。

## [AI 短剧生产台 1.3.1] - 2026-10-19

### Fixed
- 旁白配音：百炼返回 429 限流时自动退避重试（2/4/8/16/32 秒，限流不计费）；旁白改为逐条串行提交。
- 业务空间域名对语音返回 400/403/404 时，自动改走同一 Key 的北京官方接口；错误信息显示服务商原始原因（兼容 `error.message` 格式），不再只有“请求失败”。
- 第一条旁白被明确拒绝（4xx）时暂停其余旁白提交，避免一次设置错误产生十几条失败。
- 被服务商拒绝（400/401/403/404/429）的请求退还请求次数；默认请求上限 60 → 120（旧默认 60 自动视为 120）。

## [AI 短剧生产台 1.3.0] - 2026-10-19

### Added
- 角色一致性：分镜完成后为主角/配角（按出镜次数，最多 4 人）生成单人全身定妆照；之后每镜首帧把出镜角色的定妆照（最多 3 张）作为参考图，用百炼 Qwen-Image 2.0 出图，保持长相、发型和服装一致。复用已配置的百炼 Key，默认开启，可在主面板关闭、在“高级”里更换模型。
- 自动面板显示定妆照，可跳转角色页上传或更换。
- 分镜要求 character_names 列全画面中的登记角色。

### Changed
- 不再把第一张分镜首帧当作角色参考图（多人画面会污染参考）。

## [AI 短剧生产台 1.2.1] - 2026-10-19

### Fixed
- 分镜时长不再让语言模型做加减法：模型只给每镜建议镜长，`src/core/pipeline/timing.ts` 按旁白字数下限、素材上限精确配平到目标时长（帧对齐），并自动选素材时长。此前常见 56 秒/75 秒被整份判失败。
- 剧情方案节拍时长按比例归一，不再因合计差几秒失败。
- 校验失败的修复请求会附上上一版分镜和具体问题（按镜号），不再盲目重写；继续制作时，已保存的失败草稿若本地即可配平则直接采用，不再付费重生成。
- 解析分镜时裁剪字段无效不再静默丢弃整个镜头；导演设定缺字段自动补齐。
- 统一旁白语速规则（每秒约 4 字）；分镜列表显示“成片/素材”两种时长和成片合计。

## [AI 短剧生产台 1.2.0] - 2026-10-19

### Added
- 一句话成片入口：短剧故事稿直出（按成片时长自动定字数），之后全自动制作到成片。
- 阿里云百炼 Qwen3-TTS 旁白适配（`src/core/composition/tts.ts`），未配置语音服务时自动复用百炼 Key；`audio: 'auto'` 声音模式。
- 字幕烧录与片头标题（`src/core/composition/captions.ts`，Canvas 渲染 PNG + FFmpeg overlay）；SRT/VTT 按句切分。
- 成片包新增发布文案、封面、字幕.srt；方案输出 `title` 与 `publish`。
- `tests/oneline.test.mjs`：断句、Key 复用、TTS 协议、并发计数、真实 FFmpeg 滤镜图回归。

### Changed
- 首帧与视频按镜头并发生成（`runPool`，默认 3），付费请求预留/完成在单一事务内更新。
- 旁白略超镜长时 atempo 自动加速（≤1.35 倍）。
- 方案/分镜提示词加入竖屏短视频留存规则；工作台改为一句话主入口，逐步节点收进“制作细节”。

## [0.4.1] - 2026-05-04

Hot patch surfaced by a real test: 302.AI exposes Nano Banana
(gemini-2.5-flash-image) under Google's native generateContent
protocol, not the OpenAI Images API. The dramai text2image client
only spoke OpenAI Images, so calls returned `503 -10008 当前无可用
模型`.

### Added

- `ApiFlavor` enum gains `'gemini'`.
- `src/core/image/gemini-client.ts`: full
  `POST /v1beta/models/{model}:generateContent` client; sends both
  `Authorization: Bearer` and `x-goog-api-key` headers for
  cross-platform compatibility (302 / Google AI Studio / Vertex AI).
  Reference images via `inline_data` parts; decodes returned
  `inline_data` into Blobs (snake_case + camelCase tolerant).
- `src/core/image/factory.ts`: dispatches on `Provider.apiFlavor`.
- `ProviderForm` now exposes the API-flavor selector for `text2image`
  too. Per-kind filtering keeps the menu short.
- `PROVIDER_PRESETS` adds 302.AI presets for Nano Banana (Gemini),
  Flux + GPT Image 1 (OpenAI-compat), Kling (native) + generic i2v
  fallback. Each preset can pin its `apiFlavor` and the form
  auto-applies on click.
- Preset notes call out the gotcha: Gemini-flavor base URL must NOT
  include `/v1` — the protocol path is `/v1beta/models/...`.

### Changed

- `src/core/pipeline/image-shot.ts` switched from the OpenAI-compat
  client to the new factory.

## [0.4.0] - 2026-05-04

End-to-end pipeline closed: storyboard → image → video → composed cut +
subtitles + 剪映/CapCut draft package. Browser-side, no backend.

### Added (v0.2 → v0.4 condensed)

**v0.2 — Character cards + text-to-image**

- Character CRUD with per-character reference image binding and a
  `locked` toggle. Locked characters' reference Blobs are forwarded as
  `image` / `image_url` / `reference_images` fields when generating
  that shot's frame, giving the model a consistency hint across
  providers (OpenAI Images, Flux, Nano Banana, SDXL, etc.).
- OpenAI-compatible `/v1/images/generations` client with `b64_json`
  response default + URL fallback download.
- Per-shot and batch "generate image" buttons with abort, inline
  error surfacing, and live thumbnails in the storyboard list.

**v0.3 — Image-to-video + camera movement**

- `Provider.apiFlavor` selector ('openai-compatible' | 'kling' |
  'runway') exposed in Settings for image2video providers.
- Two-protocol video stack: full Kling submit/poll
  (`/v1/videos/image2video`), plus a generic OpenAI-compatible path
  (`/videos/generations`) with multi-field task-id and video-url
  extraction. Runway falls back to the generic path until its native
  client lands.
- 11 `CameraMovement` types (static / pan / tilt / zoom / orbit /
  dolly) × 3 speeds; per-shot inline select; mapped to English
  instructions injected into the video prompt.
- Storyboard rows now play the generated mp4 inline; per-shot and
  batch "generate video" buttons with abort and 10-min timeout.
- Async task handle persisted on the Storyboard row so a refresh
  doesn't lose the in-flight task (resume UI lands later).

**v0.4 — Composition + subtitles + 剪映/CapCut export**

- FFmpeg.wasm single-thread loader as a dynamic import; ~30MB core is
  fetched from jsdelivr only on the first compose click. GitHub Pages
  doesn't allow COOP/COEP so we deliberately use the single-thread
  build (slower, but works everywhere).
- `concatVideos`: per-clip transcode to a uniform H.264 / 720p / 24
  fps with letterbox padding, then concat-demuxer + copy. The composed
  mp4 is persisted as a project asset; "重新合成" cleans up the old
  one.
- SRT and VTT exporters: time axis built from each shot's
  `durationSec`, sourced from the LLM-emitted `narration`.
- 剪映/CapCut draft package (alpha): a single ZIP with `assets/`
  (per-shot mp4 / image), `subtitles.srt`, `manifest.json`, and a
  plain README guiding manual import. Direct .draft_content support is
  on the v0.5+ list.

### Changed

- `Provider` schema gains optional `apiFlavor`.
- `Storyboard` schema gains optional `cameraParams` and
  `pendingVideoTask`. No DB version bump needed (both are optional
  fields on existing index spec).
- Initial JS bundle 685 kB / 219 kB gzip (FFmpeg + jszip lazy
  chunked).

## [0.1.0] - 2026-05-04

The first usable end-to-end milestone: drop in your raw material, write
a one-line prompt, and get a structured storyboard generated by your
own OpenAI-compatible LLM — all in the browser.

### Added

- **Provider settings.** Add / edit / delete OpenAI-compatible
  providers grouped by kind (LLM / Text2Image / Image2Video / ImageEdit).
  Six one-click presets (OpenRouter, 302.AI, ciyuan, OpenAI, image
  variants). Test-connection probe with last-verified timestamp.
- **Project CRUD on IndexedDB.** Live-query list and detail pages;
  cascade delete also drops materials, storyboards, characters, assets,
  and generations.
- **Material upload.** Drag-and-drop or file picker for `.docx` /
  `.txt` / `.md` / images; per-file 20 MB cap, mammoth dynamically
  imported only when a docx actually arrives. Image previews via cached
  `URL.createObjectURL`.
- **Storyboard pipeline.** Streaming OpenAI-compatible chat completions
  (custom SSE parser handling `\n\n` / `\r\n\r\n`, multi-line `data:`
  fields, `[DONE]`, comments, tail residue). Pipeline emits
  starting / streaming / parsing / persisting / done / error events,
  abortable mid-flight. Fault-tolerant JSON parse handles `\`\`\`fence`
  wrapping and outermost-braces extraction. Character-name → id mapping
  on persist.
- **Storyboard list UI.** Live updates via dexie-react-hooks
  `useLiveQuery`; per-shot delete; status badge; image-prompt and
  duration display.
- **Backup / restore.** Export the entire local database (including
  Blob assets serialized as base64) into a single JSON, and import in
  either `merge` (id-keyed upsert) or `replace` (clear-then-write) mode.
- **i18n.** Initial Chinese / English translations for the
  marketing-facing pages (Home, About, NotFound) and chrome (header,
  footer). Locale switcher persists to `localStorage`.
- **shadcn-style design system.** Button / Card / Badge / Input /
  Textarea / Label / Select / Modal primitives, Tailwind v4 with OKLCH
  dark theme, custom GithubIcon (lucide 1.x dropped brand icons).
- **Routing & layout.** React Router v7 with `basename` derived from
  Vite `BASE_URL`, sticky header with nav, footer, brand mark.
- **Resilience fixes.** SSE parser now `await reader.cancel()` on
  consumer break to release the underlying response body. CI uses
  `npm install --prefer-offline --no-audit --no-fund` so the
  intermittent npm 11 lock-completeness drift around `@emnapi/*` no
  longer kills the workflow.

### Changed

- Node target moved to 24 in `.nvmrc` to match the local development
  environment; `engines.node` widened to `>=20.0.0 <25.0.0`.
- `vite.config.ts` enables `@tailwindcss/vite` and the `@/*` path alias.
- Bundle split: mammoth lazy-loaded into its own chunk so the initial
  download stays under 500 kB / 154 kB gzip.

## [0.0.1] - 2026-05-04

### Added

- Initial Vite + React 19 + TypeScript 6 project skeleton.
- Path alias `@/*` → `src/*`.
- Apache 2.0 license, NOTICE, README (中/EN), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.
- GitHub Actions CI workflow (lint, typecheck, build).
- GitHub Actions deploy workflow → GitHub Pages.
- Issue templates (bug / feature) and PR template.
- `vite.config.ts` configured with `base = "/dramai/"` for GitHub Pages.
- Initial documentation: ARCHITECTURE.md, DEPLOYMENT.md, PROVIDERS.md, ROADMAP.md.

[Unreleased]: https://github.com/hyyyyyyz/dramai/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/hyyyyyyz/dramai/releases/tag/v0.4.1
[0.4.0]: https://github.com/hyyyyyyz/dramai/releases/tag/v0.4.0
[0.1.0]: https://github.com/hyyyyyyz/dramai/releases/tag/v0.1.0
[0.0.1]: https://github.com/hyyyyyyz/dramai/releases/tag/v0.0.1
