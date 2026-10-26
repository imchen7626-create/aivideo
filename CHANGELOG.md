# Changelog

All notable changes to dramai are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [AI 短剧生产台 1.8.14] - 2026-10-26

### Fixed（来自 1.8.12 付费实测的逐镜验收）
- 角色设定写明人种与国籍：原文写了就照写；中文故事没写时默认「中国人，东亚面孔」。原来出图模型会随机画成欧美长相（这次男主、上次女主），和手机合照等画面对不上。
- 道具特写（画面里没有人物）的视频要求物品留在原位、不被拿起、不漂浮、不飞向镜头，只靠镜头移动展示细节。原来「推近手机」会被拍成手机飘起来贴到镜头前。
- 人物镜头的首帧和视频都要求人物在做本镜的事、视线落在动作对象或对方身上、不看镜头；负面提示加入「看镜头、对镜头微笑」。原来首帧常照搬定妆照的正面直立站姿，男主对着镜头笑。
- 相邻两镜人物姿势不再跳变：分镜规则要求躺、坐、站的变化在镜头里演出来；程序检查同一场次相邻镜头的姿势（如上一镜还躺着、本镜开头已坐在床边），发现后让分镜返工一次，返工后的分镜不会因此判失败。

## [AI 短剧生产台 1.8.13] - 2026-10-26

### Fixed（来自 1.8.12 付费实测）
- 参考图出图和视频提交遇到限流（HTTP 429）时自动等待重发（最多 5 次，约 1 分钟），不再让整条生产线停下。429 是未受理的拒收，不计费，重发不会重复扣费。
- 设置页“专用模型”填错用途时生成前就拦下：配音模型填成视频模型（如 wan3.0-video）、出图模型或口型同步模型填错，创建页和开始生成时都会提示，不再等视频付费生成完才在配音阶段报错。设置页对应输入框下方也会提示。

## [AI 短剧生产台 1.8.12] - 2026-10-26

### Changed
- 万相 3.0（wan3.0-video、wan3.0-video-prime）登记为按整秒生成（官方 2–30 秒），和 HappyHorse、wan2.7 一样每镜生成 3–8 秒、贴近成片镜长。原来只按 5 秒或 10 秒生成：3 秒的镜头要生成 5 秒再剪掉，6 秒的镜头要生成 10 秒，多付费也多裁剪。

## [AI 短剧生产台 1.8.11] - 2026-10-26

### Added
- 场景短片的时长新增「由分镜决定 · 按动作自然时长」：方案按每段动作自然需要的秒数编排，分镜的每镜时长就是成片时长（只夹在台词所需和视频模型单段上限之间），不再拉伸或压缩到 15/30/60 秒。2–8 镜，项目信息里显示「时长由分镜决定」。短剧仍按固定时长编排。

### Fixed
- 分镜裁剪的入点和出点分别取整，个别镜头会比求解出的镜长多或少一帧；现在入点取整后加上帧对齐的镜长，每镜长度与成片总长都精确。

## [AI 短剧生产台 1.8.10] - 2026-10-26

### Fixed（来自第二次付费实测的验收）
- 道具特写（画面里没有人物，如床头手机锁屏）不再参考上一镜画面：原来会照搬上一镜的全景构图，视频再从全景硬推到手机，出现手机“飘起来”、人脸纹理变形。现在只用场景定场图保持环境一致。
- 有人物的镜头参考同一地点最近一个“有人物”的镜头，跳过中间的道具特写。

## [AI 短剧生产台 1.8.9] - 2026-10-26

### Fixed（来自第二次付费实测）
- 剪辑合成失败“镜头 1 旁白长 8 秒，超过镜长 3.8 秒”：情感配音按“语速偏慢”的表演指示把 14 个字说了 8 秒。配音超出镜长（含 1.35 倍加速余量）时，自动去掉表演指示按正常语速重配一次，不再让成片失败；已做口型同步的镜头保留原配音，避免嘴型对不上。
- 表演指示不再要求放慢语速（镜长按正常语速计算），模型写的“语速慢、放慢”等字眼由程序去掉。
- 场景短片只说用户描述里的台词：模型自己加的旁白或改写的句子由程序去掉。

## [AI 短剧生产台 1.8.8] - 2026-10-25

### Fixed（来自一次付费实测）
- 视频模型会在一个镜头里自己切镜头、叠化（出现重影、内容跳变，如吐司片变成整条面包）：每镜视频提示词要求一镜到底、中途不切换不转场不叠化。
- 定妆照不再带道具：选角只写一直戴在身上的饰物，不写剧情里临时拿的东西；定妆照要求双手空着，并去掉“随身道具”短句。原来男主定妆照端着早餐盘，导致每一镜（包括烤面包时）都端着盘子。
- 同一地点始终用同一个场次；离开后再回到这个地点时，首帧参考该地点最近一次出现的画面，房间布置和人物状态（如仍躺在床上）保持一致。
- 外观要点不再把“面包”误识别为“包”，也不再带上道具。
- 需要特定形状时写出现实做法（如心形煎蛋模具），首帧就把关键道具摆进画面。

## [AI 短剧生产台 1.8.7] - 2026-10-25

### Fixed
- 场景短片支持多个地点：按描述里的地点拆场次（如卧室、厨房），“镜头一转”或换地点时切到新场次，不再把不同地点合成一个空间，也不再让一个镜头从卧室“移动”到厨房。
- 换地点或时间跳跃时，下一镜从新地点的状态开始，不再沿用上一镜的结束画面。
- 连续镜头（以上一镜尾帧为首帧）每组最多三镜，避免误差一路累积。
- 描述里点名的关键动作和道具（如烤面包、煎爱心蛋）各安排近景或特写；场景短片镜头上限从 5 镜提高到 8 镜。
- “照我的描述拍一段”输入上限从 1200 字放宽到 6000 字（原来超出部分会被截掉）。
- 每镜出图时附上角色的外观要点（发型、服装、配饰），减少同一角色在不同镜头里换发型、换衣服。

## [AI 短剧生产台 1.8.6] - 2026-10-24

### Fixed
- 换用思考型文本模型（如 qwen3 系列）后分镜步骤报“连续 120 秒没有输出”：模型先输出的思考内容（reasoning_content）原来不被识别，被当成没有输出而中断。现在思考也算在工作，进度显示“模型正在思考”，思考内容不会混入正文。
- 开始输出前的等待放宽到 5 分钟（长分镜首字可能较慢），开始输出后连续 2 分钟没有输出才中断，并分别给出原因。

## [AI 短剧生产台 1.8.5] - 2026-10-24

### Fixed
- “编一个短剧故事”不再擅自加人改设定：用户写到的人物、关系、身份、事件和结局是硬约束，人物数量以用户写的为准，不得新增分身、克隆、替身、第三者等设定；反转和标题只能来自用户给的内容。
- 在“编一个短剧故事”里粘贴剧本或分镜时（较长，或带镜号、景别、首帧等术语），直接按原文改编，不再由 AI 另写故事；输入上限从 300 字放宽到 3000 字（原来超出部分会被截掉），识别为剧本时输入框自动加高。
- 保存用户的原始输入，并在“故事与方案”里与 AI 写出的原文对照显示。
- 文本模型不再在固定 5 分钟时被打断（原报错“BodyStreamBuffer was aborted”）：改为连续 2 分钟没有输出才中断、总上限 15 分钟，并给出可读的原因与处理方式；方案的节拍描述不再写入镜头提示词，减少下一步的输出量。

## [AI 短剧生产台 1.8.4] - 2026-10-24

### Fixed
- 人物脸上的红色斑块：出图提示词不再使用“定妆”（字面是化妆定妆，模型会画成带妆的红脸蛋），改称“外观参考照”并要求素颜、自然肤色；“不要腮红”这类否定词从正向提示词移到负面提示词（正向里写反而强化）；角色描述中“脸颊泛红、红晕、眼眶发红”等面部泛红短句在出图前自动去掉，衣物颜色不受影响；每镜出图只要求五官、发型、服装与参考图一致，不复制参考图里的妆容和泛红。

### Added
- 生产台定妆照下方新增“重新生成定妆照”：只清掉这张定妆照，角色与镜头登记保留，继续制作时按新提示词重画（不必再删除角色）。

## [AI 短剧生产台 1.8.3] - 2026-10-23

### Fixed
- 场景短片的描述里没写台词时，不再凭空加台词：模型写的台词由程序清空（主动选择“解说旁白”时保留）。避免有台词的镜头改走口型同步模型，导致同一部片子里画风和清晰度不一致。
- 首帧不再直接画出动作结尾：人物姿势只按本镜起始状态，首帧提示词里写到的动作和手势视为尚未发生；导演规则加入反例说明。
- 离主角较远的人物（场边、观众席、远处）要写明距离和在画面中的大小，不再被画到主角身边；每镜只放与本镜动作相关的角色。

## [AI 短剧生产台 1.8.2] - 2026-10-23

### Fixed
- 口型同步镜头报“resolution 480P is not supported”：wan2.6、wan2.7 只有 720P/1080P，选 480P 时这些模型自动改用 720P 提交（费用按 720P）。
- 未登记的模型拒绝所选分辨率时，按报错列出的可用分辨率改用最低一档重新提交一次并记住；任务受理后才因分辨率失败的，同一次运行内重新提交，口型同步镜头仍带配音做口型。

## [AI 短剧生产台 1.8.1] - 2026-10-23

### Fixed
- 口型同步遇到短台词报“audio duration is out of range”：wan2.5/2.6 要求驱动音频 3–30 秒（wan2.7 为 2–30 秒），短于最小时长的配音上传前会在末尾补静音，成片仍使用原配音。
- 口型同步模型因音频问题拒绝时，自动改用普通视频模型生成该镜，不再让整镜失败。

## [AI 短剧生产台 1.8.0] - 2026-10-23

### Changed
- 新建作品与查看作品分开：没选作品时只显示“新建作品”；选中作品时只显示该作品的名称、实际参数与“＋ 新建作品”，不再在作品上方摆一个空白的新建表单。
- 新建作品改为三张说明清楚的方式卡片（编一个短剧故事 / 照我的描述拍一段 / 用我的小说或剧本，写小说放在后者里），只有一个输入框；顺序为描述 → 设置 → 声音，开始按钮放在最底部并写明将生成什么。
- 去掉重复的“一句话成片”标题；项目下拉框的空选项改为“＋ 新建作品”；逐步节点只在选中作品时显示。
- 选中作品时的可改设置（字幕、标题、配乐、口型、并发、请求上限）收进“本作品设置”，显示和修改的都是该作品自己的值，不再与新作品默认值混用。

### Fixed
- 场景短片按描述忠实拍摄：不再套用短剧的钩子、冲突、反转规则擅自加情节；描述里的镜头运动（环绕、推近、拉远等）会落到对应镜头。
- 描述里要求修改已有视频（如“把某 MV 里的人换成……，别的不用动”）时，生成前提示生产台无法读取或修改原视频，只能按文字重新拍一段相似画面；场景短片会尽量还原原作可辨识的场景、服装和动作，只替换指定人物，不模仿真人长相。
- 修复 1.7.4 起切换作品时控制台重复出现多份的问题（同层组件使用了相同的 key）。

## [AI 短剧生产台 1.7.4] - 2026-10-23

### Changed（界面）
- 生产台统一为三级结构：一级区块（故事与方案、分镜与镜头、成片 · 剪辑合成、逐步节点）用同一种可折叠卡片，标题旁显示镜头数、时长、完成度等摘要；区块内的原文、角色、方案和每个镜头用同一种内容卡；高级设置、编辑本镜、剪辑调整、导入 JSON、观感复核提醒用同一种折叠项。
- 区块按制作流程排序，逐步节点（专业模式）移到最后。
- 镜头卡片：缩略图按成片画幅显示并以首帧作封面；运镜与重做按钮放在描述下方，编辑表单收在最底部；批量按钮并排放在区块顶部；按钮改为“生成首帧 / 重新生成首帧 / 重新生成视频”；台词按实际说话人显示。
- 成片预览按视频比例居中显示，不再整行黑边。

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
