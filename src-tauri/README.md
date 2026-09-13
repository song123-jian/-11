# Tauri 2.x 桌面适配说明

桌面壳层已使用 Rust/Cargo 1.98.1 完成 `cargo check` 与 Release `--no-bundle` 构建。前端通过 `src/services/desktopTools.js` 调用白名单 IPC，不拼接任意 shell 命令。

## IPC 能力

- `dependency_status`：检查 LibreOffice 等桌面依赖状态。
- `office_to_pdf`：校验 Office 扩展名和输出目录后，通过独立临时配置调用 LibreOffice，超时 120 秒。
- `ping_host`：只接受合法主机和受限超时，不支持网段扫描。
- `probe_port`：只接受合法主机、单端口和受限超时，不支持端口范围扫描。
- `power_capabilities`：返回当前平台是否支持定时电源动作、固定动作清单和安全缓冲时间。
- `power_schedule_status`：读取当前一次性电源任务的状态快照。
- `schedule_power_action`：只接受 `shutdown`、`restart`、`hibernate`，校验触发时间（30 秒至 31 天）和受限 `requestId` 后创建单个调度线程。
- `cancel_power_schedule`：仅在任务仍处于等待阶段时按 `requestId` 取消；进入执行阶段后拒绝取消，避免动作竞态。

定时关机基础版仅面向 Windows 10/11 桌面运行时。关机和重启使用固定参数并保留 30 秒系统保存窗口，休眠在执行前等待同等缓冲；不带强制关闭参数，不接受任意命令或自定义脚本。浏览器模式不会调用这些 IPC 命令，周期、空闲、托盘、自启和负载阈值触发不在当前范围。

官方 `tauri-plugin-dialog` 用于文件与目录选择。CSP 只放行应用自身、IPC、按需脚本/模型 CDN，以及已明确使用的汇率、IP 和测速端点。

## 构建

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
pnpm tauri build --no-bundle
```

构建结果位于 `src-tauri/target/release/efficiency_toolbox.exe`。Office 导出 PDF 依赖本机 LibreOffice；当前机器未安装该依赖，因此界面会显示“未就绪”，其他模块不受影响。
