# 效率百宝箱

依据《文档办公与效率工具完整解决方案_V2.0》实现的 Vue 3 + Vite + Tauri 2.x 桌面效率工具。软件采用本地优先设计，文件处理默认在浏览器内存或桌面进程中完成，外部网络能力单独标识。

## 环境与运行

- Node.js 与 pnpm
- Rust 1.98.1 / Cargo 1.98.1（桌面构建）
- LibreOffice（仅 Office 导出 PDF 需要；未安装时其他功能仍可使用）

```powershell
pnpm install
pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort
```

浏览器开发地址为 `http://127.0.0.1:4173/`。生产与桌面构建：

```powershell
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri build --no-bundle
```

Release 构建后可用以下脚本按 V2.0 门禁重复采集启动与内存基线（默认 20 次），结果写入 `output/performance/release-baseline.json`：

```powershell
powershell -ExecutionPolicy Bypass -File tools/measure_release_baseline.ps1
```

启动、空闲和会话采样都会记录被测 EXE 的 SHA-256。发布门禁会逐份比对该哈希与当前 EXE；字段缺失或不匹配时安全失败，不能只重建产物或供应链清单后复用旧性能数据。现有历史 JSON 早于此字段，本次未重跑，因此不能作为当前哈希绑定的门禁证据。

按 V2.0 要求执行当前设备的 10 分钟空闲、每分钟采样：

```powershell
powershell -ExecutionPolicy Bypass -File tools/measure_idle_baseline.ps1
```

结果写入 `output/performance/idle-baseline.json`；该结果属于当前设备预基线，不替代冻结参考设备的正式发布门禁。最新结果仅 8/10 成功采样，第 9 分钟前进程退出且 `crashFree=false`，因此不能作为通过门禁证据；本次不重跑。空闲采样期间可以并行执行 `pnpm test`、`cargo test`、静态检查或其他不启动/重建同一 Release EXE 的测试；并行运行会争用 CPU/IO，不能把并行数据当作隔离性能 P95。启动 Release EXE 的三个采样脚本共享互斥锁，彼此并行时会拒绝启动，避免测试夹具互相结束进程。

可按 V2.0 的启动会话口径默认执行 200 次 Release EXE 稳定性采样（每次验证主窗口就绪，随后由测试夹具结束进程树；仍可通过 `-Samples` 显式增加样本）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/measure_session_stability.ps1
```

结果写入 `output/performance/session-stability-baseline.json`；默认门禁口径现为 200 次，但本次未执行新的 200 次采样。已有 10,000/10,000 结果仅作为历史高强度证据保留，不能代替当前 200 次样本或冻结参考设备、真实用户操作链路的正式发布验收。

可重复生成依赖、锁文件、Release 产物哈希和签名状态清单：

```powershell
node tools/build_supply_chain_manifest.mjs
```

结果写入 `output/performance/supply-chain-manifest.json`；当前清单会记录 13 个前端直接依赖的许可证、481 个 Rust 包的许可证字段，并明确记录安装包 `NotSigned` 和更新清单签名未配置状态。

发布环境配置更新清单签名私钥后，可生成并校验 Ed25519 detached signature；私钥只从环境变量指向的本地文件读取，不写入项目：

```powershell
$env:EFFICIENCY_UPDATE_SIGNING_PRIVATE_KEY = 'C:\secure\efficiency-update-signing-private.pem'
node tools/build_supply_chain_manifest.mjs
```

脚本会写入 `output/performance/supply-chain-manifest.sig`，并在清单中记录 `updateManifestSignatureStatus=valid`；EXE/NSIS 仍必须单独通过 Authenticode 签名，未满足两类签名时 `releaseQualified` 保持 `false`。

可在发布或更新服务端部署前，使用独立验签工具按原始清单字节核对 detached signature。公钥只读自受控文件，不写入清单或日志；验签失败会以退出码 1 fail-closed：

```powershell
node tools/verify_update_manifest.mjs `
  --manifest output/performance/supply-chain-manifest.json `
  --signature output/performance/supply-chain-manifest.sig `
  --public-key C:\secure\efficiency-update-signing-public.pem
```

也可以设置 `EFFICIENCY_UPDATE_MANIFEST_PATH`、`EFFICIENCY_UPDATE_SIGNATURE_PATH` 和 `EFFICIENCY_UPDATE_PUBLIC_KEY_PATH` 后不带路径参数运行。该检查只验证清单签名，不替代 EXE/NSIS Authenticode 签名门禁。

可在采样结果生成后执行一次完整发布门禁汇总。门禁会校验 20 次启动、10 分钟空闲、200 次会话、主应用内存/启动阈值、CC Switch 安装器注册、产物哈希和两类签名；任一项未满足都会写出报告并以退出码 1 结束：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify_release_gate.ps1
```

报告写入 `output/performance/release-gate-report.json`。现有报告仍按旧 10,000 次门槛及旧空闲/产物证据生成，不是现行 200 次门禁结论；本次未运行新的发布门禁。发布环境配置当前用户证书存储中的代码签名证书和时间戳服务后，使用签名工具签署 EXE 与 NSIS，并自动重建供应链清单：

```powershell
$env:EFFICIENCY_CODE_SIGN_CERTIFICATE_THUMBPRINT = '证书指纹'
$env:EFFICIENCY_TIMESTAMP_SERVER = 'https://时间戳服务.example'
powershell -NoProfile -ExecutionPolicy Bypass -File tools/sign_release.ps1
```

签名工具会在证书不存在、无私钥、缺少代码签名 EKU 或未配置时间戳服务时拒绝继续；本项目不保存证书私钥、时间戳凭据或 API Key。

综合门禁还会调用 `tools/verify_update_manifest.mjs` 对更新清单和 detached signature 做独立验签。正式门禁运行前需设置 `EFFICIENCY_UPDATE_PUBLIC_KEY_PATH` 指向受控公钥文件；未配置或验签失败时，`supply-chain-signatures` 保持失败：

```powershell
$env:EFFICIENCY_UPDATE_PUBLIC_KEY_PATH = 'C:\secure\efficiency-update-signing-public.pem'
powershell -NoProfile -ExecutionPolicy Bypass -File tools/verify_release_gate.ps1
```

可用 Playwright 生成 10 张 100 行中文栅格样本，并用 Tesseract.js 统计合成样本 CER（首次运行会下载 `chi_sim` 模型）：

```powershell
node tools/measure_ocr_synthetic.mjs
```

结果写入 `output/performance/ocr-synthetic-baseline.json`；该脚本用于工程基线，不替代 V2.0 要求的冻结参考设备真实中文印刷体测试集。

可生成并验证真实 DOCX/XLSX/PPTX 到 PDF 的 Office 转换样本（需要 LibreOffice；样本脚本只写入 `output/validation/office-samples/`）：

```powershell
python tools/generate_office_samples.py
$soffice = (Resolve-Path output/validation/libreoffice-25.8.7/admin/program/soffice.exe).Path
powershell -NoProfile -ExecutionPolicy Bypass -File tools/validate_office_conversion.ps1 -SofficePath $soffice
$env:EFFICIENCY_LIBREOFFICE_PATH = $soffice
cargo test --manifest-path src-tauri/Cargo.toml tests::portable_libreoffice_conversion_smoke -- --ignored
```

结果写入 `output/performance/office-conversion-baseline.json` 和 `output/validation/office-pdfs-scripted/`；可选传入 `-PdfInfoPath` 记录 PDF 页数。最后一条命令直接调用应用的 Rust Office 转换内核并输出临时 PDF，测试结束会清理临时目录。当前验证使用 LibreOffice 25.8.7 的官方 MSI 无管理员解包目录，部署环境仍需单独锁定版本。

桌面版会优先检测系统安装目录和 `PATH`；需要使用便携版时，可在启动桌面程序前设置可执行文件路径：

```powershell
$env:EFFICIENCY_LIBREOFFICE_PATH = (Resolve-Path output/validation/libreoffice-25.8.7/admin/program/soffice.exe).Path
```

该环境变量只接受本地 `soffice.exe` 文件，不会自动扫描用户目录。

桌面可执行文件输出到 `src-tauri/target/release/efficiency_toolbox.exe`。
NSIS 安装器输出到 `src-tauri/target/release/bundle/nsis/效率百宝箱_0.1.0_x64-setup.exe`；当前安装器未配置代码签名证书。
Release profile 已启用 LTO、单 codegen 单元、符号剥离和 `panic=abort`，用于减小发布产物体积；这不会替代代码签名或正式发布门禁。

## 已实现能力

- 工作台：采用 VS Code/Postman 风格的可折叠导航与全宽工作区；侧栏支持 234px 导航与 64px 图标轨，状态会记住折叠态和舒适/紧凑密度。全局搜索支持名称、别名/关键词与最近使用排序；Ctrl+Shift+P 打开命令面板，可用上下箭头、Home/End、Enter 执行布局、任务中心、设置和工具命令；工具通过统一注册表进入搜索与命令面板，新工具只需提供 id、模块、标签、说明和图标即可扩展。首页新增“图像类专区”，集中展示图片压缩、截图、长截图、批量水印、长图拼接、AI 图片增强、证件照裁剪和图片文字编辑，并可一键进入对应工具。设置中心采用桌面双栏结构，分为“API 设置”和“任务选项”：API 设置集中管理本地 OCR（无需 Token）、DeepSeek 默认预设、自定义中转站和 CC Switch A+B+C；任务选项承载外观、工作区密度、联网授权、运行依赖、更新状态与隐私诊断，并提供受影响工具的入口。
- 文档办公：PDF 合并/拆分、批量重命名副本（桌面版支持文件/目录选择与冲突策略）、ZIP 创建/提取、DOCX 办公模板、Tesseract.js OCR、LibreOffice 导出适配器和文档打印；打印工作区支持 PDF/图片/文本预览、A4/A5/B4（JIS）/B5（JIS）纸张、方向、页码范围、奇偶/逆序、缩放、双面和辅助选项，设置只在用户修改后保存到本机；批量文档入口支持真实拖放或系统选择，选择阶段会提示格式、空文件、重复文件和 ZIP 同名输出冲突，并在执行前汇总输入、处理顺序和输出方式；桌面写入遇到无权限目录或磁盘空间不足时会给出可执行恢复提示。
- 效率助手：提供总览仪表盘、任务管理、专注管理、日程管理、快捷便签、办公工具箱、会议纪要、模板库和中转站 AI 助手。待办支持高/中/低优先级、分类标签、截止时间与逾期置顶、子任务、批量操作、拖拽排序和四象限视图；番茄钟支持多套工作/短休/长休方案、自动循环、待办投入时长、七日趋势与雨声/咖啡馆白噪音；提醒支持每日/每周/每月/工作日/自定义重复、提前提醒、月历、分类和星标；便签支持实时自动保存、颜色分类、搜索、一键转待办/提醒；工具箱提供正/倒计时、去格式、字数统计、大小写转换及二维码/单位换算入口；会议纪要可提取行动项为待办并生成结构化便签，模板库可一键套用工作清单与复盘模板。异步任务统一记录等待、运行、取消中、成功、失败和已取消状态，任务中心显示当前阶段、进度，以及适用时的完成数、总数和剩余项；清除已完成任务历史须二次确认并可在 30 秒内撤销。
- 本地状态：只允许主题、任务、最近工具、联网授权、待办、便签、提醒、效率助手、打印设置和 `ui-prefs` 十类命名空间键；`ui-prefs` 只保存侧栏折叠态、工作区密度、上次工具和任务中心固定态。普通值使用 schema 1 版本封装并兼容读取旧格式，类型或长度异常时安全回退。效率助手状态统一保存在 `assistant` 键，并向旧版本待办/便签/提醒键提供兼容镜像。任务历史另用字段白名单，只保存 operation、状态、进度/项目计数、时间和稳定错误码；标签、错误说明与恢复动作在加载时由受控映射重建，原始错误、完整路径、口令、API Key 和任意附加字段不会写入任务记录。
- 隐私诊断：设置页可先预览、再手动下载诊断 ZIP；本地滚动日志最多保留 30 条，只包含白名单内的操作、状态、阶段、耗时、输入数量和稳定错误码。导出时会再次规范化快照，并固定生成 `manifest.json`、`task-events.json`、`privacy.txt`；文档正文、文件内容、口令与密钥、完整文件路径、便签和提醒正文主动排除，崩溃上报与自动上传固定关闭。
- 数据计算：单位、日期、百分比、计算器、汇率、房贷、年度个税和 BMI；计算器支持括号与常见全角运算符，结果同时显示数字小写金额和人民币中文大写金额，输入与结果仅在本机处理。
- Excel / CSV 工具：支持多表合并、按列拆分、去重、转置，以及 JSON、CSV、XLSX 之间的格式互转；结果支持 CSV、JSON、XLSX 下载，按列拆分会生成 ZIP。文件只在浏览器本机解析，单文件上限 50 MB、100,000 行、256 列、单元格 20,000 字符；XLSX 读取首个工作表，旧版 `.xls` 暂不支持，建议另存为 `.xlsx` 或 CSV。
- 网络工具：二维码生成/识别、条形码生成（Code 128/EAN-13）、公网 IP、下载测速，以及 Tauri 白名单 Ping/单端口探测。银行卡号信息查询不在本次实施范围内，不接入 BIN 数据或银行卡接口。
- 图片处理：压缩/格式转换、压到指定 KB、系统截图、定时分段长截图、批量文字水印、横向/纵向长图拼接，以及本地 AI 图片增强、边缘背景估计抠图、证件照规格裁剪和画布文字编辑。目标 KB 模式会迭代调整质量与尺寸并尽量不超过目标，受图片编码器和内容复杂度影响时会明确显示“已尽量压缩”；AI 工作区默认不上传原图。证件照提供小一寸、一寸、大一寸、二寸、护照/签证常见及自定义像素规格，右侧展示毫米、像素、用途和背景色参考；证件照结果可按 A4/A5/B4/B5、方向、边距、间距、DPI、份数和裁剪线生成相纸排版 PNG，并直接进入浏览器/系统打印入口；文字编辑支持选区、透明/纯色消除、文字替换、添加文字、内部复制粘贴、撤销/重做和 OCR 提取。首页“图像类专区”提供上述能力的集中入口，沿用本地处理、结果另存和授权提示。
- 安全隐私：强密码、强度检测、OpenPGP 口令加密/解密和敏感信息脱敏副本。
- 定时关机：独立导航入口提供倒计时或定点时间触发，支持关机、重启、休眠；创建前确认参数，显示剩余时间与状态，并可在触发前取消。

### 工作台扩展约定

工具入口统一由 `src/services/toolRegistry.js` 管理。内置工具和后续插件使用相同定义：`id`、`module`、`label`、`description`、`icon`，可选 `aliases`；注册后自动进入全局搜索和命令面板。任务中心默认以浮动抽屉显示，点击图钉可固定为第三栏；模块页顶部的边界/依赖条会在缺失 LibreOffice、桌面桥接或网络时高亮，并可按当前会话关闭。Tab 采用不换行滚动容器和左右箭头，避免工具数量增长时挤压结果区。首页“快速开始”按最近使用优先、其余按注册表顺序补足 8 个；无论从首页、全局搜索、命令面板还是模块内 Tab 进入工具，都会统一更新最近使用顺序，模块卡片标题随当前工具动态显示。

### 效率助手使用说明

效率助手以标签页方式组织日常工作流，所有待办、提醒、便签、专注会话、会议纪要和模板数据均由 `assistant` 状态统一管理，并在输入变化后自动保存到本机。快捷键 `Ctrl+Alt+T`、`Ctrl+Alt+N`、`Ctrl+Alt+F` 分别打开待办、便签和番茄钟；顶部工具栏可导出完整 JSON 备份或待办 CSV，也可从 JSON 备份恢复。导入会替换当前效率助手数据，执行前会显示确认提示。

- 任务管理：新增待办时可同时设置优先级、分类、标签、截止时间、首个子任务和截止提醒；列表支持搜索、按优先级/截止时间排序、逾期标记、批量完成/删除/改元数据、拖拽排序及重要-紧急四象限。
- 专注与统计：在方案库中保存工作、短休、长休和长休触发周期；专注可关联待办并累计投入分钟数，自动循环会在工作与休息阶段间轮转；总览仪表盘可切换日/周/月并显示对应周期的待办完成、新建数量和专注汇总，番茄钟页同时展示日/周/月时长、番茄数和近七日趋势。白噪音只在用户开启且浏览器支持 Web Audio 时播放。
- 日程与信息卡：提醒支持重复规则、提前通知、月视图、分类、星标和待办关联；便签按颜色/分类管理，输入后延迟自动保存，可搜索并转换为待办或提醒。首次新增提醒时，在浏览器支持的情况下可请求通知权限；拒绝权限不影响本机提醒保存。
- 协作辅助：会议纪要按主题、时间、参会人、要点和行动项记录；“提取待办并存档”会逐行生成待办、保存纪要并创建结构化便签。模板库提供每日计划、周清单、项目跟进、会议纪要、每日复盘和问题记录模板。
- 工具聚合：工具箱内置正计时/倒计时和文本处理（去格式、字符/词/行统计、大小写转换），二维码和单位换算通过现有工具页打开，不复制或上传输入内容。

### 图片处理增强说明

- AI 图片：`智能增强`对像素做本地亮度、对比度和饱和度校正；`AI 抠图`从四角估计背景色，只处理与画布边缘相连的相似区域，可输出透明 PNG 或替换为白/蓝/红底 JPG。运行时页明确显示“Canvas Local Vision”和未加载第三方模型，避免把启发式算法当作深度模型。
- 证件照：裁剪服务按目标比例进行高质量 Cover 裁剪，支持主体水平/垂直焦点、常用规格和自定义像素；规格表同时给出毫米、像素、用途、可用背景色、来源和更新时间，并提示以办证机构最新要求为准。背景替换沿用边缘连通估计，复杂背景需人工复核。
- 文字编辑：画布建立不超过 2400px 长边的编辑副本，提供选择、透明/纯色消除、框选替换文字、添加文字、内部复制粘贴、撤销/重做和 PNG 导出；OCR 仍走既有本地 Tesseract.js，首次语言模型下载前单独请求联网授权，待识别图片不发送到服务商。
- 性能与安全：大图限制像素总量并使用分阶段任务进度；历史快照限制为 18 步，URL 在切换和卸载时释放；任何结果均另存，不覆盖源文件。中转站视觉接口未假设存在，只有未来明确配置并完成供应商能力探测后才可扩展。

### Excel / CSV 与证件照排版

- 表格工作区支持本地读取 CSV、TSV、JSON 和 XLSX；多表合并按表头对齐，按列拆分按值分组并打包 ZIP，去重保留首次记录，转置互换行列，格式转换可输出 CSV、JSON 或轻量 XLSX。XLSX 读写使用本地 ZIP/XML 处理，当前只读取首个工作表；旧版 `.xls` 暂不支持。
- 表格输入设置了可控边界：单文件不超过 50 MB，最多 100,000 行、256 列，单元格不超过 20,000 字符；超限或 CSV 引号未闭合会在本地直接提示，文件内容不会上传。
- 图片压缩的目标 KB 模式是“尽量达到”而非无损精确承诺：服务会在质量和尺寸之间迭代，并在无法达到目标时返回实际大小与提示。证件照相纸排版复用已生成的 Canvas 结果，输出新 PNG，不覆盖原图或证件照结果。
- 当前打印按钮已接入浏览器隐藏打印帧/系统打印对话框入口；本轮验证完成排版 PNG 生成、下载和按钮呈现，未实际打开系统打印对话框。PDF 进阶能力本轮不补充，现有 PDF 合并/拆分和打印能力保持不变。

PDF、ZIP、OCR、图片和加密工具均生成副本，不覆盖源文件。汇率、公网 IP、测速、Ping、单端口探测、OCR 首次模型下载及中转站请求只会在用户主动点击后进入联网授权流程。当前 AI 图片能力使用 Canvas Local Vision 本地启发式算法（增强、边缘连通背景移除/替换），不等同于已加载的深度学习模型；复杂背景建议人工复核，云端视觉模型不会被自动调用。

### 条形码与文档打印

- 条形码生成完全在本机完成，支持 Code 128 与 EAN-13；EAN-13 输入 12 位时自动计算校验位，输入 13 位时校验校验位。可调整条宽、条高、留白、颜色和底部编码文字，并下载 PNG/SVG。
- 文档打印工作区支持 PDF、图片和文本预览，纸张提供 A4（210×297 mm）、A5（148×210 mm）、B4（JIS，257×364 mm）和 B5（JIS，182×257 mm），并提供自动/纵向/横向、当前/全部/自定义页码、奇偶/逆序、缩放、双面及水印、页码、页眉、裁剪标记、分割页面等选项。浏览器模式通过 `@page` 和系统打印对话框回退，Office 文件请先导出 PDF。
- 打印偏好使用版本化 `print-settings` 本地键保存。组件首次打开只读取已有值，不写回默认值；用户修改后才规范化保存，因此刷新或重新进入不会无故改变选择。恢复默认是显式操作。
- 银行卡号信息查询明确不实施：不采集或存储银行卡号，不接入 BIN 数据库、银行接口或第三方银行卡识别服务。

## 联网授权与离线行为

- 首页、全局搜索、最近使用和工具页统一标记“离线”“需联网”或“需插件”；顶部状态会在系统断网时显示“当前离线”。
- 每项联网用途在首次执行前独立展示供应商、发送数据、用途和取消方式。授权账本采用 schema 2，并同时绑定用途、供应商地址和 `fr-g06-v1` 策略版本；供应商地址或策略变化后必须重新确认。
- 汇率、公网 IP、测速、OCR 模型下载、Ping、端口探测、中转站连接测试和中转站正文发送分别授权。中转站连接测试只查询模型列表，不能替代正文发送授权。
- 断网时汇率、IP、测速、Ping、端口和中转站任务不会启动；OCR 只尝试本机已缓存资源。拒绝授权或确认期间撤回授权时，请求函数不会执行。
- 设置页撤回授权会取消所有活动联网任务，并阻止失败任务绕过授权直接重试；浏览器请求使用 AbortSignal，Tauri 中转站、Ping 和端口任务使用 `requestId` 对应的 Rust 取消登记。

## 中转站 API

“API 设置”页支持 OpenAI-compatible 中转站：填写 `Base URL` 和 API Key 即可测试 `/models`；如果只填写服务商根地址（例如 `https://catbee.online`），客户端会自动规范为标准 `/v1` 前缀，已有 `/v1` 或其他明确路径保持不变。页面同时提供本地 OCR 运行时检测（无需 Token）和 DeepSeek 快捷预设（官方 Key 入口、`https://api.deepseek.com/v1`、`deepseek-chat`）；连接成功后会提供模型 ID 建议，也可手动填写模型名，再在“效率助手”中发送 Chat Completions 请求。Tauri 桌面版由 Rust 网络客户端发起请求以规避常见 CORS 限制，浏览器开发模式使用 Fetch 回退。

- API Key 仅保存在当前进程内存，不写入 `localStorage`、`sessionStorage`、本机历史、任务历史、日志或隐私诊断包；保存、加载和清除配置时会主动清除旧版本可能留下的本机密钥。应用进程结束后密钥不可恢复，可在设置页一键清除当前进程内存中的密钥。
- 仅在用户点击“测试连接”或“发送到中转站”后联网；两种动作使用独立授权，并在确认前显示服务商、发送数据、用途和取消方式。
- Base URL 只允许 `http`/`https`，不允许账号密码、查询参数或片段；消息角色、长度、模型名和请求超时均有边界校验。
- 模型发现遇到 408/425/429/5xx 时使用最多两次、总时限受控的有限退避；聊天请求只有在任务提供受控 `requestId` 时才携带 `Idempotency-Key` 并最多重试一次。浏览器和 Rust 客户端均可取消正在等待的请求或退避，撤回授权后重试仍需重新确认。
- 当前未在发布包内固化任何服务商地址或 API Key，请在设置中使用你信任的中转站配置。
- 如使用 Cat Bee 中转站，Base URL 可直接填写 `https://catbee.online`（客户端会规范为 `https://catbee.online/v1`）；本项目已验证该地址的模型发现接口可返回模型列表，但聊天接口可用性仍取决于服务商状态。

### CC Switch 互通（A+B+C）

设置页的“CC Switch 互通”支持三种方式：

- A：粘贴并解析官方 `ccswitch://v1/import?resource=provider` 供应商深链接，预览字段后应用到当前中转站配置。
- B：桌面版主动选择 CC Switch 的 `.db`、`.sqlite`、`.sqlite3` 或 `.sql` 文件，只读提取 `providers` 供应商；不会自动扫描用户目录，也不会上传文件。SQL 备份只在内存 SQLite 中执行，并拒绝外部附加数据库、扩展加载等高风险语句。
- C：按 Codex、Claude、Gemini 等应用类型生成可导入的 `ccswitch://` 深链接或 JSON。导出内容会明文包含 API Key，生成和复制前请确认目标是可信的 CC Switch 实例。

桌面版已注册 `ccswitch://` Windows 协议。通过系统协议启动时，应用仅提取首个、长度受限且路径固定的 `ccswitch://v1/import` 参数，在设置弹窗中展示掩码预览；原始链接不会写入输入框、日志或本机存储，仍需用户手动点击“应用到中转站”。

长截图会在一次屏幕/窗口授权后按设定帧数和间隔捕获分段，用户需要在间隔内滚动目标内容；结果由本地 Canvas 纵向拼接，不会把普通单次截图冒充长截图。

## 导航定时关机

定时关机是 Windows 桌面版的一次性电源任务入口，适合下载、渲染、编译或备份完成后的自动收尾。可在“定时关机”导航中选择：

- 触发方式：倒计时或本地定点时间；执行窗口限制为当前时间之后 30 秒至 31 天。
- 执行动作：关机、重启或休眠。关机与重启提交 Windows 固定电源命令并保留 30 秒系统保存缓冲，不带强制关闭参数；休眠在执行前保留同等缓冲。
- 任务控制：同一时间只允许一个活动任务；确认后显示计划时间、剩余时间和终态，可在进入执行阶段前取消。
- 安全边界：前端只能提交固定动作、时间和受限 requestId；Rust IPC 再次校验并以取消令牌保护调度状态。浏览器模式只展示预览，不调用系统命令。

当前基础版不包含周期/空闲/进程退出/负载阈值触发、系统托盘、开机自启、多任务并行、自定义脚本或强制关闭程序。真实电源动作应在 Windows 桌面版或隔离测试设备上验证，浏览器验收仅覆盖参数、状态和布局。

## 已知限制

- 当前机器未系统安装 LibreOffice；本轮使用官方 LibreOffice 25.8.7 MSI 无管理员解包目录完成 DOCX、XLSX、PPTX 各 1 页真实样本转 PDF，3/3 成功。部署环境仍需锁定可用版本并纳入正式发布镜像。
- 已建立 1000 行合成中文栅格样本的 OCR CER 统计脚本；合成结果不计入真实中文印刷体 CER 发布门禁。
- 长截图的参数校验、界面链路和拼接逻辑已验证；屏幕共享授权与真实滚动样本仍需在目标桌面环境中采样。
- 已完成 Chromium 640×800 窄视口下的 200% 等效重排、1280×800 逐模块可访问名称/目标尺寸巡检、设置弹窗键盘焦点循环及 API 设置/任务选项标签键盘导航；实际系统文本缩放、对比度和屏幕阅读器矩阵仍需在冻结参考设备上验收。
- 当前产物包含可运行 Release EXE 与 NSIS 安装器；现行会话门禁已调整为 200 次，但本次未执行新的 200 次窗口就绪启动会话采样。10,000/10,000 结果仅为历史高强度证据；最新 10 分钟空闲预基线为 8/10、`crashFree=false`，不构成通过证据。冻结参考设备复测、真实用户操作链路、代码签名、更新供应链和方案文档中的完整发布门禁仍需独立验收。
- 详细状态、验证证据和恢复说明见 [`docs/HANDOFF.md`](docs/HANDOFF.md)。
