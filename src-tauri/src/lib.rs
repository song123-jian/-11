use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    ffi::OsStr,
    io::{Read, Write},
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

mod shutdown;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub mode: &'static str,
    pub version: &'static str,
    pub platform: &'static str,
    #[serde(rename = "ccSwitchLink")]
    pub ccswitch_link: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub platform: &'static str,
    pub libreoffice: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeConversion {
    pub input_name: String,
    pub output_path: Option<String>,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCopyResult {
    pub input_name: String,
    pub output_path: Option<String>,
    pub output_name: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkResult {
    pub success: bool,
    pub elapsed_ms: u128,
    pub detail: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct RelayMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RelayConnectionResult {
    provider: String,
    model_count: usize,
    model: String,
    models: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RelayChatResult {
    content: String,
    model: String,
    usage: Option<serde_json::Value>,
    provider: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CcSwitchProviderSummary {
    id: String,
    name: String,
    app_type: String,
    base_url: String,
    model: String,
    api_key: String,
}

const NETWORK_TOMBSTONE_TTL: Duration = Duration::from_secs(30);
const MAX_CCSWITCH_DEEPLINK_LENGTH: usize = 64 * 1024;

struct NetworkJobEntry {
    token: Arc<AtomicBool>,
    generation: u64,
    registered: bool,
    created_at: Instant,
}

type NetworkCancellationRegistry = Mutex<HashMap<String, NetworkJobEntry>>;

static NETWORK_CANCELLATIONS: OnceLock<NetworkCancellationRegistry> = OnceLock::new();
static NETWORK_GENERATION: OnceLock<Mutex<u64>> = OnceLock::new();

struct NetworkJobRegistration {
    request_id: String,
    generation: u64,
    token: Arc<AtomicBool>,
}

impl Drop for NetworkJobRegistration {
    fn drop(&mut self) {
        unregister_network_job(&self.request_id, self.generation, &self.token);
    }
}

fn network_cancellations() -> &'static NetworkCancellationRegistry {
    NETWORK_CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_network_generation() -> Option<u64> {
    let counter = NETWORK_GENERATION.get_or_init(|| Mutex::new(0));
    let mut counter = counter.lock().ok()?;
    *counter = counter.wrapping_add(1).max(1);
    Some(*counter)
}

fn prune_network_tombstones(jobs: &mut HashMap<String, NetworkJobEntry>) {
    jobs.retain(|_, entry| entry.registered || entry.created_at.elapsed() < NETWORK_TOMBSTONE_TTL);
}

fn register_network_job(
    request_id: Option<&str>,
) -> Result<Option<NetworkJobRegistration>, String> {
    let Some(request_id) = request_id.map(str::trim).filter(|id| !id.is_empty()) else {
        return Ok(None);
    };
    let generation = next_network_generation().ok_or_else(|| "无法分配网络任务标识".to_string())?;
    let mut jobs = network_cancellations()
        .lock()
        .map_err(|_| "网络任务状态不可用".to_string())?;
    prune_network_tombstones(&mut jobs);
    let token = if let Some(entry) = jobs.get_mut(request_id) {
        if entry.registered {
            return Err("请求已在运行".into());
        }
        entry.registered = true;
        entry.generation = generation;
        entry.created_at = Instant::now();
        entry.token.clone()
    } else {
        let token = Arc::new(AtomicBool::new(false));
        jobs.insert(
            request_id.to_string(),
            NetworkJobEntry {
                token: token.clone(),
                generation,
                registered: true,
                created_at: Instant::now(),
            },
        );
        token
    };
    Ok(Some(NetworkJobRegistration {
        request_id: request_id.to_string(),
        generation,
        token,
    }))
}

fn unregister_network_job(request_id: &str, generation: u64, token: &Arc<AtomicBool>) {
    let request_id = request_id.trim();
    if request_id.is_empty() {
        return;
    }
    if let Ok(mut jobs) = network_cancellations().lock() {
        let should_remove = jobs.get(request_id).is_some_and(|entry| {
            entry.registered && entry.generation == generation && Arc::ptr_eq(&entry.token, token)
        });
        if should_remove {
            jobs.remove(request_id);
        }
    }
}

fn network_job_canceled(token: &Option<Arc<AtomicBool>>) -> bool {
    token
        .as_ref()
        .map(|value| value.load(Ordering::Acquire))
        .unwrap_or(false)
}

#[tauri::command]
fn cancel_network_job(request_id: String) -> bool {
    let request_id = request_id.trim();
    if request_id.is_empty() {
        return false;
    }
    let Some(generation) = next_network_generation() else {
        return false;
    };
    let Ok(mut jobs) = network_cancellations().lock() else {
        return false;
    };
    prune_network_tombstones(&mut jobs);
    if let Some(entry) = jobs.get(request_id) {
        entry.token.store(true, Ordering::Release);
        return true;
    }
    jobs.insert(
        request_id.to_string(),
        NetworkJobEntry {
            token: Arc::new(AtomicBool::new(true)),
            generation,
            registered: false,
            created_at: Instant::now(),
        },
    );
    true
}

fn remaining_until(deadline: Instant) -> Duration {
    deadline
        .checked_duration_since(Instant::now())
        .unwrap_or_default()
}

fn resolve_addresses_with_deadline(
    target: String,
    deadline: Instant,
    token: &Option<Arc<AtomicBool>>,
) -> Result<Vec<SocketAddr>, String> {
    if network_job_canceled(token) {
        return Err("任务已取消".into());
    }
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let result = target
            .to_socket_addrs()
            .map(|addresses| addresses.collect::<Vec<_>>())
            .map_err(|_| "DNS 解析失败".to_string());
        let _ = sender.send(result);
    });
    loop {
        if network_job_canceled(token) {
            return Err("任务已取消".into());
        }
        let remaining = remaining_until(deadline);
        if remaining.is_zero() {
            return Err("DNS 解析超时".into());
        }
        match receiver.recv_timeout(remaining.min(Duration::from_millis(100))) {
            Ok(result) => return result,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err("DNS 解析失败".into()),
        }
    }
}

fn find_on_path(executable: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|directory| directory.join(executable))
        .find(|candidate| candidate.is_file())
}

fn configured_libreoffice_path(configured: Option<PathBuf>) -> Option<PathBuf> {
    configured.filter(|candidate| candidate.is_file())
}

fn libreoffice_path() -> Option<PathBuf> {
    if let Some(configured) = configured_libreoffice_path(
        std::env::var_os("EFFICIENCY_LIBREOFFICE_PATH").map(PathBuf::from),
    ) {
        return Some(configured);
    }
    #[cfg(target_os = "windows")]
    {
        let candidates = [
            PathBuf::from(r"C:\Program Files\LibreOffice\program\soffice.exe"),
            PathBuf::from(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"),
        ];
        candidates
            .into_iter()
            .find(|candidate| candidate.is_file())
            .or_else(|| find_on_path("soffice.exe"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        find_on_path("soffice")
    }
}

fn validate_host(host: &str) -> Result<&str, String> {
    let host = host.trim();
    if host.is_empty() || host.len() > 253 {
        return Err("主机名不能为空且不能超过 253 个字符".into());
    }
    if !host
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | ':'))
    {
        return Err("主机名包含不允许的字符".into());
    }
    Ok(host)
}

fn output_reader<R: Read + Send + 'static>(mut stream: R) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut output = String::new();
        let _ = stream.read_to_string(&mut output);
        output
    })
}

fn resolve_output_path(
    output_directory: &Path,
    file_stem: &str,
    conflict_policy: &str,
) -> Result<PathBuf, String> {
    let preferred = output_directory.join(format!("{file_stem}.pdf"));
    if !preferred.exists() {
        return Ok(preferred);
    }
    if conflict_policy == "stop" {
        return Err(format!(
            "输出文件已存在，未执行覆盖：{}",
            preferred.display()
        ));
    }
    for suffix in 1..=9_999 {
        let candidate = output_directory.join(format!("{file_stem} ({suffix}).pdf"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("无法找到可用的输出文件名".into())
}

fn validate_filename_pattern(pattern: &str) -> Result<(), String> {
    if pattern.trim().is_empty() {
        return Err("命名模板不能为空".into());
    }
    if pattern.contains("{n}") {
        // The placeholder is replaced before the final Windows filename check.
    }
    if pattern.chars().any(|character| {
        matches!(
            character,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
        ) || character.is_control()
    }) {
        return Err("命名模板包含 Windows 不允许的字符".into());
    }
    Ok(())
}

fn resolve_copy_output(
    output_directory: &Path,
    filename: &str,
    conflict_policy: &str,
) -> Result<PathBuf, String> {
    let preferred = output_directory.join(filename);
    if !preferred.exists() {
        return Ok(preferred);
    }
    if conflict_policy == "stop" {
        return Err(format!(
            "输出文件已存在，未执行覆盖：{}",
            preferred.display()
        ));
    }
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(OsStr::to_str)
        .ok_or_else(|| "无法生成输出文件名".to_string())?;
    let extension = path.extension().and_then(OsStr::to_str).unwrap_or_default();
    for suffix in 1..=9_999 {
        let candidate_name = if extension.is_empty() {
            format!("{stem} ({suffix})")
        } else {
            format!("{stem} ({suffix}).{extension}")
        };
        let candidate = output_directory.join(candidate_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("无法找到可用的输出文件名".into())
}

fn renamed_filename(input: &Path, pattern: &str, index: usize) -> Result<String, String> {
    validate_filename_pattern(pattern)?;
    let stem = pattern.replace("{n}", &format!("{:02}", index + 1));
    let extension = input
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or_default();
    if stem.trim().is_empty() {
        return Err("命名模板替换后为空".into());
    }
    if extension.is_empty() {
        Ok(stem)
    } else {
        Ok(format!("{stem}.{extension}"))
    }
}

fn describe_output_write_error(action: &str, error: &std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        return format!("{action}失败：输出目录没有写入权限，请选择可写目录后重试");
    }
    if matches!(error.raw_os_error(), Some(28) | Some(39) | Some(112)) {
        return format!("{action}失败：磁盘空间不足，未完成该文件副本");
    }
    format!("{action}失败：{error}")
}

fn copy_renamed_file(
    input: &Path,
    output_directory: &Path,
    pattern: &str,
    index: usize,
    conflict_policy: &str,
) -> Result<(String, PathBuf), String> {
    let input = input
        .canonicalize()
        .map_err(|_| "输入文件不存在或无法访问".to_string())?;
    if !input.is_file() {
        return Err("输入路径不是文件".into());
    }
    let output_directory = output_directory
        .canonicalize()
        .map_err(|_| "输出目录不存在或无法访问".to_string())?;
    if !output_directory.is_dir() {
        return Err("输出位置必须是目录".into());
    }
    let filename = renamed_filename(&input, pattern, index)?;
    let output = resolve_copy_output(&output_directory, &filename, conflict_policy)?;
    if input == output {
        return Err("输出路径不能与源文件相同".into());
    }

    let mut source =
        std::fs::File::open(&input).map_err(|error| format!("读取源文件失败：{error}"))?;
    let mut destination = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&output)
        .map_err(|error| describe_output_write_error("创建输出文件", &error))?;
    if let Err(error) =
        std::io::copy(&mut source, &mut destination).and_then(|_| destination.flush())
    {
        drop(destination);
        let message = describe_output_write_error("复制文件", &error);
        if let Err(cleanup_error) = std::fs::remove_file(&output) {
            return Err(format!("{message}；不完整输出清理失败：{cleanup_error}"));
        }
        return Err(message);
    }
    let output_name = output
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or(&filename)
        .to_string();
    Ok((output_name, output))
}

fn run_libreoffice(
    input: &Path,
    output_directory: &Path,
    executable: &Path,
    conflict_policy: &str,
) -> Result<PathBuf, String> {
    const ALLOWED_EXTENSIONS: &[&str] = &[
        "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
    ];
    let extension = input
        .extension()
        .and_then(OsStr::to_str)
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "输入文件缺少扩展名".to_string())?;
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!("不支持 .{extension} 文件"));
    }
    let input = input
        .canonicalize()
        .map_err(|_| "输入文件不存在或无法访问".to_string())?;
    let output_directory = output_directory
        .canonicalize()
        .map_err(|_| "输出目录不存在或无法访问".to_string())?;
    if !output_directory.is_dir() {
        return Err("输出位置必须是目录".into());
    }
    let file_stem = input
        .file_stem()
        .and_then(OsStr::to_str)
        .ok_or_else(|| "无法生成输出文件名".to_string())?;
    if conflict_policy == "stop" {
        resolve_output_path(&output_directory, file_stem, conflict_policy)?;
    }

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let profile = std::env::temp_dir().join(format!(
        "efficiency-toolbox-lo-{}-{nonce}",
        std::process::id()
    ));
    std::fs::create_dir_all(&profile).map_err(|_| "无法创建 LibreOffice 临时目录".to_string())?;
    let conversion_directory = output_directory.join(format!(
        ".efficiency-toolbox-output-{}-{nonce}",
        std::process::id()
    ));
    if let Err(error) = std::fs::create_dir(&conversion_directory) {
        let _ = std::fs::remove_dir_all(&profile);
        return Err(describe_output_write_error("创建转换临时目录", &error));
    }
    let profile_uri = match url::Url::from_directory_path(&profile) {
        Ok(uri) => uri.to_string(),
        Err(_) => {
            let _ = std::fs::remove_dir_all(&profile);
            let _ = std::fs::remove_dir_all(&conversion_directory);
            return Err("无法生成 LibreOffice 临时目录地址".into());
        }
    };
    let mut child = Command::new(executable)
        .arg(format!("-env:UserInstallation={profile_uri}"))
        .args(["--headless", "--convert-to", "pdf", "--outdir"])
        .arg(&conversion_directory)
        .arg(&input)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| {
            let _ = std::fs::remove_dir_all(&profile);
            let _ = std::fs::remove_dir_all(&conversion_directory);
            "无法启动 LibreOffice".to_string()
        })?;
    let stdout_reader = child.stdout.take().map(output_reader);
    let stderr_reader = child.stderr.take().map(output_reader);

    let started_at = Instant::now();
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|_| "无法读取 LibreOffice 状态".to_string())?
        {
            break status;
        }
        if started_at.elapsed() > Duration::from_secs(120) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.map(|reader| reader.join());
            let _ = stderr_reader.map(|reader| reader.join());
            let _ = std::fs::remove_dir_all(&profile);
            let _ = std::fs::remove_dir_all(&conversion_directory);
            return Err("Office 转 PDF 超过 120 秒，任务已终止".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    };
    let stdout = stdout_reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    let stderr = stderr_reader
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    if !status.success() {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        let error = format!(
            "LibreOffice 转换失败：{}",
            detail.chars().take(300).collect::<String>()
        );
        let _ = std::fs::remove_dir_all(&profile);
        let _ = std::fs::remove_dir_all(&conversion_directory);
        return Err(error);
    }
    let generated = conversion_directory.join(format!("{file_stem}.pdf"));
    if !generated.is_file() {
        let _ = std::fs::remove_dir_all(&profile);
        let _ = std::fs::remove_dir_all(&conversion_directory);
        return Err("LibreOffice 已退出，但未找到转换后的 PDF".into());
    }
    let output = match resolve_output_path(&output_directory, file_stem, conflict_policy) {
        Ok(output) => output,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&profile);
            let _ = std::fs::remove_dir_all(&conversion_directory);
            return Err(error);
        }
    };
    let move_result = std::fs::rename(&generated, &output)
        .map_err(|error| describe_output_write_error("保存转换后的 PDF", &error));
    let _ = std::fs::remove_dir_all(&profile);
    let _ = std::fs::remove_dir_all(&conversion_directory);
    move_result.map(|_| output)
}

fn extract_ccswitch_deep_link<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().skip(1).find_map(|argument| {
        let value = argument.as_ref().trim();
        if value.is_empty() || value.len() > MAX_CCSWITCH_DEEPLINK_LENGTH {
            return None;
        }
        let parsed = url::Url::parse(value).ok()?;
        if parsed.scheme() != "ccswitch"
            || parsed.host_str() != Some("v1")
            || parsed.path() != "/import"
        {
            return None;
        }
        Some(value.to_owned())
    })
}

#[tauri::command]
fn runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        mode: "tauri",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        ccswitch_link: extract_ccswitch_deep_link(std::env::args()),
    }
}

#[tauri::command]
fn dependency_status() -> DependencyStatus {
    DependencyStatus {
        platform: std::env::consts::OS,
        libreoffice: libreoffice_path().map(|path| path.display().to_string()),
    }
}

fn validate_relay_url(value: &str) -> Result<url::Url, String> {
    let raw = value.trim().trim_end_matches('/');
    if raw.is_empty() {
        return Err("请先在设置中填写中转站 Base URL".into());
    }
    let mut parsed = url::Url::parse(raw)
        .map_err(|_| "中转站 Base URL 必须是完整的 http(s) 地址".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("中转站 Base URL 仅支持 http 或 https".into());
    }
    if parsed.host_str().is_none() {
        return Err("中转站 Base URL 缺少主机名".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Base URL 不应包含账号或密码".into());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("Base URL 不应包含查询参数或片段".into());
    }
    if parsed.path().is_empty() || parsed.path() == "/" {
        parsed.set_path("/v1");
    }
    Ok(parsed)
}

fn relay_endpoint(base: &url::Url, suffix: &str) -> Result<url::Url, String> {
    let mut endpoint = base.clone();
    let base_path = endpoint.path().trim_end_matches('/');
    let path = if base_path.ends_with(suffix) {
        base_path.to_string()
    } else {
        format!("{base_path}{suffix}")
    };
    endpoint.set_path(if path.is_empty() { suffix } else { &path });
    Ok(endpoint)
}

fn relay_provider(base: &url::Url) -> String {
    base.host_str().unwrap_or("中转站").to_string()
}

fn validate_relay_inputs(base_url: &str, model: &str, api_key: &str) -> Result<url::Url, String> {
    let base = validate_relay_url(base_url)?;
    if model.trim().is_empty() || model.trim().len() > 200 {
        return Err("中转站模型名不能为空且不能超过 200 个字符".into());
    }
    if api_key.trim().is_empty() || api_key.len() > 512 {
        return Err("中转站 API Key 不能为空且不能超过 512 个字符".into());
    }
    Ok(base)
}

fn validate_relay_connection_inputs(
    base_url: &str,
    model: &str,
    api_key: &str,
) -> Result<url::Url, String> {
    let base = validate_relay_url(base_url)?;
    if model.trim().len() > 200 {
        return Err("中转站模型名不能超过 200 个字符".into());
    }
    if api_key.trim().is_empty() || api_key.len() > 512 {
        return Err("中转站 API Key 不能为空且不能超过 512 个字符".into());
    }
    Ok(base)
}

fn relay_model_ids(data: &serde_json::Value) -> Vec<String> {
    data.get("data")
        .and_then(serde_json::Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter_map(|item| item.get("id").and_then(serde_json::Value::as_str))
                .map(str::trim)
                .filter(|id| !id.is_empty() && id.len() <= 200)
                .take(200)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn relay_status_error(status: reqwest::StatusCode) -> String {
    match status.as_u16() {
        401 | 403 => "中转站鉴权失败，请检查 API Key".into(),
        404 => "中转站接口不存在，请确认 Base URL 包含正确的 /v1 路径".into(),
        429 => "中转站请求过于频繁，请稍后重试".into(),
        code if code >= 500 => format!("中转站服务暂时不可用（HTTP {code}）"),
        code => format!("中转站返回 HTTP {code}"),
    }
}

const RELAY_CONNECTION_MAX_RETRIES: usize = 2;
const RELAY_CHAT_MAX_RETRIES: usize = 1;
const RELAY_RETRY_BASE_DELAY_MS: u64 = 250;
const RELAY_RETRY_MAX_DELAY_MS: u64 = 2_000;

fn relay_status_is_retryable(status: reqwest::StatusCode) -> bool {
    status == reqwest::StatusCode::REQUEST_TIMEOUT
        || status == reqwest::StatusCode::TOO_EARLY
        || status == reqwest::StatusCode::TOO_MANY_REQUESTS
        || status.is_server_error()
}

fn relay_retry_delay(headers: &reqwest::header::HeaderMap, attempt: usize) -> Duration {
    if let Some(seconds) = headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok())
    {
        return Duration::from_secs(seconds.min(RELAY_RETRY_MAX_DELAY_MS / 1_000));
    }
    let multiplier = 1_u64 << attempt.min(3);
    Duration::from_millis(
        RELAY_RETRY_BASE_DELAY_MS
            .saturating_mul(multiplier)
            .min(RELAY_RETRY_MAX_DELAY_MS),
    )
}

async fn wait_for_relay_retry(
    delay: Duration,
    token: &Option<Arc<AtomicBool>>,
) -> Result<(), String> {
    tokio::select! {
        _ = tokio::time::sleep(delay) => Ok(()),
        _ = wait_for_network_cancellation(token) => Err("任务已取消".into()),
    }
}

fn relay_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化中转站网络客户端".to_string())
}

async fn wait_for_network_cancellation(token: &Option<Arc<AtomicBool>>) {
    loop {
        if network_job_canceled(token) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn relay_response_text(data: &serde_json::Value) -> String {
    let content = data
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("content"));
    match content {
        Some(serde_json::Value::String(value)) => value.trim().to_string(),
        Some(serde_json::Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(serde_json::Value::as_str))
            .collect::<String>()
            .trim()
            .to_string(),
        _ => String::new(),
    }
}

#[tauri::command]
async fn relay_test_connection(
    base_url: String,
    model: String,
    api_key: String,
    timeout_ms: u64,
    request_id: Option<String>,
) -> Result<RelayConnectionResult, String> {
    let base = validate_relay_connection_inputs(&base_url, &model, &api_key)?;
    let endpoint = relay_endpoint(&base, "/models")?;
    let timeout = Duration::from_millis(timeout_ms.clamp(5_000, 120_000));
    let client = relay_client(timeout)?;
    let registration = register_network_job(request_id.as_deref())?;
    let token = registration.as_ref().map(|job| job.token.clone());
    if network_job_canceled(&token) {
        return Err("任务已取消".into());
    }
    let mut attempt = 0;
    let response = loop {
        let request = client
            .get(endpoint.clone())
            .bearer_auth(api_key.trim())
            .header(reqwest::header::ACCEPT, "application/json")
            .send();
        let response = tokio::select! {
            response = request => response.map_err(|_| "中转站连接失败，请检查地址和网络后重试".to_string())?,
            _ = wait_for_network_cancellation(&token) => return Err("任务已取消".into()),
        };
        if response.status().is_success() {
            break response;
        }
        if attempt >= RELAY_CONNECTION_MAX_RETRIES || !relay_status_is_retryable(response.status())
        {
            return Err(relay_status_error(response.status()));
        }
        let delay = relay_retry_delay(response.headers(), attempt);
        attempt += 1;
        wait_for_relay_retry(delay, &token).await?;
    };
    let data: serde_json::Value = tokio::select! {
        data = response.json() => data.map_err(|_| "中转站返回了无法解析的 JSON".to_string())?,
        _ = wait_for_network_cancellation(&token) => return Err("任务已取消".into()),
    };
    let models = relay_model_ids(&data);
    let result = RelayConnectionResult {
        provider: relay_provider(&base),
        model_count: models.len(),
        model: model.trim().to_string(),
        models,
    };
    drop(registration);
    Ok(result)
}

#[tauri::command]
async fn relay_chat(
    base_url: String,
    model: String,
    api_key: String,
    messages: Vec<RelayMessage>,
    temperature: f64,
    max_tokens: u32,
    timeout_ms: u64,
    request_id: Option<String>,
) -> Result<RelayChatResult, String> {
    let base = validate_relay_inputs(&base_url, &model, &api_key)?;
    if messages.is_empty() || messages.len() > 100 {
        return Err("中转站消息数量必须在 1-100 条之间".into());
    }
    let total_chars = messages.iter().try_fold(0usize, |total, message| {
        if !matches!(message.role.as_str(), "system" | "user" | "assistant") {
            return Err("中转站消息角色仅支持 system、user、assistant".to_string());
        }
        if message.content.trim().is_empty() || message.content.len() > 100_000 {
            return Err("中转站单条消息不能为空且不能超过 100000 个字符".to_string());
        }
        total
            .checked_add(message.content.len())
            .filter(|size| *size <= 500_000)
            .ok_or_else(|| "中转站消息总长度不能超过 500000 个字符".to_string())
    })?;
    let _ = total_chars;
    let temperature = if temperature.is_finite() {
        temperature.clamp(0.0, 2.0)
    } else {
        0.2
    };
    let max_tokens = max_tokens.clamp(1, 32_768);
    let endpoint = relay_endpoint(&base, "/chat/completions")?;
    let timeout = Duration::from_millis(timeout_ms.clamp(5_000, 120_000));
    let client = relay_client(timeout)?;
    let registration = register_network_job(request_id.as_deref())?;
    let token = registration.as_ref().map(|job| job.token.clone());
    if network_job_canceled(&token) {
        return Err("任务已取消".into());
    }
    let body = serde_json::json!({
        "model": model.trim(),
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    });
    let idempotency_key = request_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 200 && value.is_ascii());
    let max_retries = if idempotency_key.is_some() {
        RELAY_CHAT_MAX_RETRIES
    } else {
        0
    };
    let mut attempt = 0;
    let response = loop {
        let mut request = client
            .post(endpoint.clone())
            .bearer_auth(api_key.trim())
            .header(reqwest::header::ACCEPT, "application/json")
            .json(&body);
        if let Some(idempotency_key) = idempotency_key {
            request = request.header("Idempotency-Key", idempotency_key);
        }
        let request = request.send();
        let response = tokio::select! {
            response = request => response.map_err(|_| "中转站请求失败，请检查地址和网络后重试".to_string())?,
            _ = wait_for_network_cancellation(&token) => return Err("任务已取消".into()),
        };
        if response.status().is_success() {
            break response;
        }
        if attempt >= max_retries || !relay_status_is_retryable(response.status()) {
            return Err(relay_status_error(response.status()));
        }
        let delay = relay_retry_delay(response.headers(), attempt);
        attempt += 1;
        wait_for_relay_retry(delay, &token).await?;
    };
    if network_job_canceled(&token) {
        return Err("任务已取消".into());
    }
    if !response.status().is_success() {
        return Err(relay_status_error(response.status()));
    }
    let data: serde_json::Value = tokio::select! {
        data = response.json() => data.map_err(|_| "中转站返回了无法解析的 JSON".to_string())?,
        _ = wait_for_network_cancellation(&token) => return Err("任务已取消".into()),
    };
    let content = relay_response_text(&data);
    if content.is_empty() {
        return Err("中转站未返回可读文本".into());
    }
    let result = RelayChatResult {
        content,
        model: data
            .get("model")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(model.trim())
            .to_string(),
        usage: data.get("usage").cloned(),
        provider: relay_provider(&base),
    };
    drop(registration);
    Ok(result)
}

const CCSWITCH_IMPORT_MAX_BYTES: u64 = 64 * 1024 * 1024;
const CCSWITCH_IMPORT_MAX_PROVIDERS: usize = 200;

fn json_string_for_keys(value: &serde_json::Value, keys: &[&str], depth: usize) -> Option<String> {
    if depth > 8 {
        return None;
    }
    match value {
        serde_json::Value::Object(object) => {
            for (key, value) in object {
                if keys
                    .iter()
                    .any(|candidate| key.eq_ignore_ascii_case(candidate))
                {
                    if let Some(text) = value
                        .as_str()
                        .map(str::trim)
                        .filter(|text| !text.is_empty())
                    {
                        return Some(text.to_string());
                    }
                }
            }
            object
                .values()
                .find_map(|value| json_string_for_keys(value, keys, depth + 1))
        }
        serde_json::Value::Array(values) => values
            .iter()
            .find_map(|value| json_string_for_keys(value, keys, depth + 1)),
        _ => None,
    }
}

fn toml_string_for_keys(value: &str, keys: &[&str]) -> Option<String> {
    for line in value.lines() {
        let Some((key, raw_value)) = line.trim().split_once('=') else {
            continue;
        };
        if !keys
            .iter()
            .any(|candidate| key.trim().eq_ignore_ascii_case(candidate))
        {
            continue;
        }
        let mut raw_value = raw_value.trim();
        if let Some(comment) = raw_value.find(" #") {
            raw_value = raw_value[..comment].trim_end();
        }
        let value = raw_value
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .or_else(|| {
                raw_value
                    .strip_prefix('\'')
                    .and_then(|value| value.strip_suffix('\''))
            })
            .unwrap_or(raw_value)
            .trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

fn extract_ccswitch_fields(settings_config: &str) -> (String, String, String) {
    let json = serde_json::from_str::<serde_json::Value>(settings_config).unwrap_or_default();
    let toml = json_string_for_keys(&json, &["config"], 0).unwrap_or_default();
    let base_url = json_string_for_keys(
        &json,
        &[
            "ANTHROPIC_BASE_URL",
            "GOOGLE_GEMINI_BASE_URL",
            "baseUrl",
            "base_url",
            "baseURL",
            "endpoint",
        ],
        0,
    )
    .or_else(|| toml_string_for_keys(&toml, &["base_url", "baseUrl", "baseURL", "endpoint"]))
    .unwrap_or_default();
    let model = json_string_for_keys(
        &json,
        &["ANTHROPIC_MODEL", "GEMINI_MODEL", "model", "defaultModel"],
        0,
    )
    .or_else(|| toml_string_for_keys(&toml, &["model", "default_model"]))
    .unwrap_or_default();
    let api_key = json_string_for_keys(
        &json,
        &[
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "OPENAI_API_KEY",
            "GEMINI_API_KEY",
            "GOOGLE_API_KEY",
            "apiKey",
            "api_key",
        ],
        0,
    )
    .or_else(|| toml_string_for_keys(&toml, &["api_key", "apiKey", "OPENAI_API_KEY"]))
    .unwrap_or_default();
    (
        base_url.chars().take(2_000).collect(),
        model.chars().take(200).collect(),
        api_key.chars().take(512).collect(),
    )
}

fn reject_unsafe_ccswitch_sql(sql: &str) -> Result<(), String> {
    let lowered = sql.to_ascii_lowercase();
    for marker in [
        "attach database",
        "detach database",
        "vacuum into",
        "load_extension",
        "create virtual table",
        "pragma writable_schema",
    ] {
        if lowered.contains(marker) {
            return Err("SQL 备份包含不允许执行的 SQLite 语句".into());
        }
    }
    Ok(())
}

fn query_ccswitch_providers(
    connection: &Connection,
) -> Result<Vec<CcSwitchProviderSummary>, String> {
    let mut statement = connection
        .prepare(
            "SELECT id, app_type, name, settings_config
             FROM providers
             ORDER BY app_type, name
             LIMIT 200",
        )
        .map_err(|error| format!("无法读取 CC Switch providers 表：{error}"))?;
    let rows = statement
        .query_map([], |row| {
            let settings_config: String = row.get(3)?;
            let (base_url, model, api_key) = extract_ccswitch_fields(&settings_config);
            Ok(CcSwitchProviderSummary {
                id: row.get(0)?,
                app_type: row.get(1)?,
                name: row.get(2)?,
                base_url,
                model,
                api_key,
            })
        })
        .map_err(|error| format!("无法解析 CC Switch providers 表：{error}"))?;
    let mut providers = Vec::new();
    for row in rows {
        providers.push(row.map_err(|error| format!("无法读取 CC Switch 供应商：{error}"))?);
    }
    if providers.is_empty() {
        return Err("CC Switch 文件中未找到供应商配置".into());
    }
    Ok(providers)
}

fn parse_ccswitch_sql(sql: &str) -> Result<Vec<CcSwitchProviderSummary>, String> {
    reject_unsafe_ccswitch_sql(sql)?;
    let connection = Connection::open_in_memory()
        .map_err(|error| format!("无法创建临时 SQLite 数据库：{error}"))?;
    connection
        .execute_batch(sql)
        .map_err(|error| format!("CC Switch SQL 备份解析失败：{error}"))?;
    query_ccswitch_providers(&connection)
}

fn read_ccswitch_file(path: &Path) -> Result<Vec<CcSwitchProviderSummary>, String> {
    let metadata =
        std::fs::metadata(path).map_err(|_| "CC Switch 文件不存在或无法访问".to_string())?;
    if !metadata.is_file() {
        return Err("CC Switch 路径不是文件".into());
    }
    if metadata.len() > CCSWITCH_IMPORT_MAX_BYTES {
        return Err("CC Switch 文件不能超过 64 MiB".into());
    }
    let extension = path
        .extension()
        .and_then(OsStr::to_str)
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "CC Switch 文件缺少扩展名".to_string())?;
    match extension.as_str() {
        "sql" => {
            let sql = std::fs::read_to_string(path)
                .map_err(|_| "无法以 UTF-8 读取 CC Switch SQL 备份".to_string())?;
            parse_ccswitch_sql(&sql)
        }
        "db" | "sqlite" | "sqlite3" => {
            let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|error| format!("无法以只读方式打开 CC Switch 数据库：{error}"))?;
            query_ccswitch_providers(&connection)
        }
        _ => Err("仅支持 .db、.sqlite、.sqlite3 或 .sql 文件".into()),
    }
}

#[tauri::command]
fn read_ccswitch_providers(file_path: String) -> Result<Vec<CcSwitchProviderSummary>, String> {
    let raw = file_path.trim();
    if raw.is_empty() {
        return Err("请选择 CC Switch 数据库或 SQL 备份文件".into());
    }
    let path = PathBuf::from(raw)
        .canonicalize()
        .map_err(|_| "CC Switch 文件不存在或无法访问".to_string())?;
    let providers = read_ccswitch_file(&path)?;
    if providers.len() > CCSWITCH_IMPORT_MAX_PROVIDERS {
        return Err("CC Switch 供应商数量不能超过 200 个".into());
    }
    Ok(providers)
}

#[tauri::command]
async fn office_to_pdf(
    inputs: Vec<String>,
    output_directory: String,
    conflict_policy: String,
) -> Result<Vec<OfficeConversion>, String> {
    if inputs.is_empty() || inputs.len() > 50 {
        return Err("请选择 1-50 个 Office 文件".into());
    }
    if !matches!(conflict_policy.as_str(), "stop" | "rename") {
        return Err("未知同名输出策略".into());
    }
    let executable =
        libreoffice_path().ok_or_else(|| "未检测到 LibreOffice，请安装后重试".to_string())?;
    let results = tauri::async_runtime::spawn_blocking(move || {
        let output_directory = PathBuf::from(output_directory);
        inputs
            .into_iter()
            .map(|input| {
                let input_path = PathBuf::from(&input);
                let input_name = input_path
                    .file_name()
                    .and_then(OsStr::to_str)
                    .unwrap_or("Office 文件")
                    .to_string();
                match run_libreoffice(
                    &input_path,
                    &output_directory,
                    &executable,
                    &conflict_policy,
                ) {
                    Ok(output) => OfficeConversion {
                        input_name,
                        output_path: Some(output.display().to_string()),
                        success: true,
                        error: None,
                    },
                    Err(error) => OfficeConversion {
                        input_name,
                        output_path: None,
                        success: false,
                        error: Some(error),
                    },
                }
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|_| "Office 转换任务异常结束".to_string())?;
    Ok(results)
}

#[tauri::command]
async fn copy_renamed_files(
    inputs: Vec<String>,
    output_directory: String,
    pattern: String,
    conflict_policy: String,
) -> Result<Vec<FileCopyResult>, String> {
    if inputs.is_empty() || inputs.len() > 500 {
        return Err("请选择 1-500 个文件".into());
    }
    validate_filename_pattern(&pattern)?;
    if !matches!(conflict_policy.as_str(), "stop" | "rename") {
        return Err("未知同名输出策略".into());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let output_directory = PathBuf::from(output_directory)
            .canonicalize()
            .map_err(|_| "输出目录不存在或无法访问".to_string())?;
        if !output_directory.is_dir() {
            return Err("输出位置必须是目录".into());
        }

        Ok(inputs
            .into_iter()
            .enumerate()
            .map(|(index, input)| {
                let input_path = PathBuf::from(&input);
                let input_name = input_path
                    .file_name()
                    .and_then(OsStr::to_str)
                    .unwrap_or("文件")
                    .to_string();
                let planned_name = renamed_filename(&input_path, &pattern, index)
                    .unwrap_or_else(|_| input_name.clone());
                match copy_renamed_file(
                    &input_path,
                    &output_directory,
                    &pattern,
                    index,
                    &conflict_policy,
                ) {
                    Ok((output_name, output)) => FileCopyResult {
                        input_name,
                        output_path: Some(output.display().to_string()),
                        output_name,
                        success: true,
                        error: None,
                    },
                    Err(error) => FileCopyResult {
                        input_name,
                        output_path: None,
                        output_name: planned_name,
                        success: false,
                        error: Some(error),
                    },
                }
            })
            .collect::<Vec<_>>())
    })
    .await
    .map_err(|_| "批量重命名任务异常结束".to_string())?
}

#[tauri::command]
async fn ping_host(
    host: String,
    timeout_ms: u64,
    request_id: Option<String>,
) -> Result<NetworkResult, String> {
    let host = validate_host(&host)?.to_string();
    let timeout_ms = timeout_ms.clamp(250, 30_000);
    let registration = register_network_job(request_id.as_deref())?;
    let token = registration.as_ref().map(|job| job.token.clone());
    let result = tauri::async_runtime::spawn_blocking(move || {
        let started_at = Instant::now();
        let timeout_arg = timeout_ms.to_string();
        let mut command = Command::new("ping");
        #[cfg(target_os = "windows")]
        command.args(["-n", "1", "-w", &timeout_arg, &host]);
        #[cfg(target_os = "linux")]
        {
            let timeout_arg = (timeout_ms.div_ceil(1000)).to_string();
            command.args(["-c", "1", "-W", &timeout_arg, &host]);
        }
        #[cfg(target_os = "macos")]
        command.args(["-c", "1", "-W", &timeout_arg, &host]);
        #[cfg(all(
            not(target_os = "windows"),
            not(target_os = "linux"),
            not(target_os = "macos")
        ))]
        command.args(["-c", "1", &host]);
        let mut child = command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "无法启动系统 Ping 工具".to_string())?;
        let deadline = Duration::from_millis(timeout_ms.saturating_add(2_000));
        loop {
            if network_job_canceled(&token) {
                let _ = child.kill();
                let _ = child.wait();
                return Err("任务已取消".into());
            }
            if let Some(status) = child
                .try_wait()
                .map_err(|_| "无法读取系统 Ping 状态".to_string())?
            {
                return Ok(NetworkResult {
                    success: status.success(),
                    elapsed_ms: started_at.elapsed().as_millis(),
                    detail: if status.success() {
                        "主机响应正常".into()
                    } else {
                        "请求超时或主机不可达".into()
                    },
                });
            }
            if started_at.elapsed() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                return Ok(NetworkResult {
                    success: false,
                    elapsed_ms: started_at.elapsed().as_millis(),
                    detail: "请求超时或主机不可达".into(),
                });
            }
            std::thread::sleep(Duration::from_millis(40));
        }
    })
    .await
    .map_err(|_| "Ping 任务异常结束".to_string())?;
    drop(registration);
    result
}

#[tauri::command]
async fn probe_port(
    host: String,
    port: u16,
    timeout_ms: u64,
    request_id: Option<String>,
) -> Result<NetworkResult, String> {
    let host = validate_host(&host)?.to_string();
    if port == 0 {
        return Err("端口必须在 1-65535 之间".into());
    }
    let timeout = Duration::from_millis(timeout_ms.clamp(250, 30_000));
    let registration = register_network_job(request_id.as_deref())?;
    let token = registration.as_ref().map(|job| job.token.clone());
    let result = tauri::async_runtime::spawn_blocking(move || {
        let target = if host.contains(':') {
            format!("[{host}]:{port}")
        } else {
            format!("{host}:{port}")
        };
        let started_at = Instant::now();
        let deadline = started_at + timeout;
        let addresses = resolve_addresses_with_deadline(target, deadline, &token)?;
        for address in addresses {
            if network_job_canceled(&token) {
                return Err("任务已取消".into());
            }
            let remaining = remaining_until(deadline);
            if remaining.is_zero() {
                break;
            }
            match TcpStream::connect_timeout(&address, remaining) {
                Ok(_) => {
                    return Ok(NetworkResult {
                        success: true,
                        elapsed_ms: started_at.elapsed().as_millis(),
                        detail: format!("端口 {port} 可连接"),
                    });
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::ConnectionRefused
                            | std::io::ErrorKind::PermissionDenied
                            | std::io::ErrorKind::AddrNotAvailable
                            | std::io::ErrorKind::InvalidInput
                    ) => {}
                Err(_) => {}
            }
        }
        if network_job_canceled(&token) {
            return Err("任务已取消".into());
        }
        Ok(NetworkResult {
            success: false,
            elapsed_ms: started_at.elapsed().as_millis(),
            detail: format!("端口 {port} 超时或拒绝连接"),
        })
    })
    .await
    .map_err(|_| "端口检测任务异常结束".to_string())?;
    drop(registration);
    result
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            dependency_status,
            office_to_pdf,
            copy_renamed_files,
            ping_host,
            probe_port,
            cancel_network_job,
            relay_test_connection,
            relay_chat,
            read_ccswitch_providers,
            shutdown::power_capabilities,
            shutdown::power_schedule_status,
            shutdown::schedule_power_action,
            shutdown::cancel_power_schedule,
        ])
        .run(tauri::generate_context!())
        .expect("error while running efficiency toolbox");
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::net::TcpListener;

    fn test_directory(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "efficiency-toolbox-test-{name}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir(&directory).expect("create test directory");
        directory
    }

    #[test]
    fn configured_libreoffice_path_accepts_only_existing_files() {
        let directory = test_directory("libreoffice-path");
        let executable = directory.join("soffice.exe");
        std::fs::write(&executable, b"portable marker").expect("write portable marker");
        assert_eq!(
            configured_libreoffice_path(Some(executable.clone())),
            Some(executable)
        );
        assert_eq!(
            configured_libreoffice_path(Some(directory.join("missing.exe"))),
            None
        );
        std::fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    #[ignore = "需要显式设置 EFFICIENCY_LIBREOFFICE_PATH 后运行"]
    fn portable_libreoffice_conversion_smoke() {
        let executable =
            libreoffice_path().expect("set EFFICIENCY_LIBREOFFICE_PATH to soffice.exe");
        let input = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("output/validation/office-samples/office-sample.docx")
            .canonicalize()
            .expect("office sample must exist");
        let output_directory = test_directory("libreoffice-conversion");
        let output = run_libreoffice(&input, &output_directory, &executable, "stop")
            .expect("portable LibreOffice conversion should succeed");
        assert!(output.is_file());
        assert!(
            std::fs::metadata(&output)
                .expect("read converted PDF")
                .len()
                > 0
        );
        std::fs::remove_dir_all(output_directory).expect("remove conversion output");
    }

    fn spawn_relay_mock_server(
        responses: Vec<String>,
    ) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind relay mock server");
        let address = listener.local_addr().expect("read relay mock address");
        let handle = std::thread::spawn(move || {
            let mut requests = Vec::with_capacity(responses.len());
            for response_body in responses {
                let (mut stream, _) = listener.accept().expect("accept relay mock request");
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .expect("set relay mock read timeout");
                let mut request = Vec::new();
                let mut chunk = [0_u8; 4096];
                let (header_end, content_length) = loop {
                    let read = stream.read(&mut chunk).expect("read relay mock request");
                    if read == 0 {
                        break (request.len(), 0);
                    }
                    request.extend_from_slice(&chunk[..read]);
                    if let Some(position) =
                        request.windows(4).position(|window| window == b"\r\n\r\n")
                    {
                        let header_end = position + 4;
                        let headers = String::from_utf8_lossy(&request[..header_end]);
                        let content_length = headers
                            .lines()
                            .find_map(|line| {
                                line.strip_prefix("Content-Length:")
                                    .or_else(|| line.strip_prefix("content-length:"))
                            })
                            .and_then(|value| value.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        break (header_end, content_length);
                    }
                };
                while request.len() < header_end.saturating_add(content_length) {
                    let read = stream.read(&mut chunk).expect("read relay mock body");
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&chunk[..read]);
                }
                requests.push(String::from_utf8_lossy(&request).into_owned());
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("write relay mock response");
            }
            requests
        });
        (format!("http://{address}/v1"), handle)
    }

    #[test]
    fn host_validation_rejects_shell_and_range_syntax() {
        assert_eq!(validate_host("127.0.0.1"), Ok("127.0.0.1"));
        assert_eq!(validate_host("::1"), Ok("::1"));
        assert!(validate_host("example.com && whoami").is_err());
        assert!(validate_host("192.168.1.0/24").is_err());
        assert!(validate_host("").is_err());
    }

    #[test]
    fn output_conflict_policy_never_overwrites_existing_pdf() {
        let directory = test_directory("output-conflict");
        let preferred = directory.join("report.pdf");
        std::fs::write(&preferred, b"existing").expect("write existing output");

        let stop = resolve_output_path(&directory, "report", "stop");
        assert!(stop.is_err());
        assert_eq!(
            std::fs::read(&preferred).expect("read existing output"),
            b"existing"
        );

        let renamed =
            resolve_output_path(&directory, "report", "rename").expect("resolve renamed output");
        assert_eq!(
            renamed.file_name().and_then(OsStr::to_str),
            Some("report (1).pdf")
        );
        assert!(!renamed.exists());

        std::fs::remove_dir_all(&directory).expect("remove test directory");
    }

    #[test]
    fn output_write_errors_have_actionable_recovery_messages() {
        let denied = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "access denied");
        assert_eq!(
            describe_output_write_error("创建输出文件", &denied),
            "创建输出文件失败：输出目录没有写入权限，请选择可写目录后重试"
        );

        let disk_full = std::io::Error::from_raw_os_error(112);
        assert_eq!(
            describe_output_write_error("复制文件", &disk_full),
            "复制文件失败：磁盘空间不足，未完成该文件副本"
        );
    }

    #[test]
    fn rename_pattern_rejects_windows_invalid_characters_and_expands_index() {
        for character in ['<', '>', ':', '"', '/', '\\', '|', '?', '*'] {
            assert!(validate_filename_pattern(&format!("report{character}{{n}}")).is_err());
        }
        assert_eq!(
            renamed_filename(Path::new("source.docx"), "归档-{n}", 2).expect("rename file"),
            "归档-03.docx"
        );
    }

    #[test]
    fn renamed_copy_never_overwrites_and_preserves_source_sha256() {
        let directory = test_directory("renamed-copy");
        let source = directory.join("source.txt");
        let preferred = directory.join("归档-01.txt");
        std::fs::write(&source, b"source-content").expect("write source");
        std::fs::write(&preferred, b"existing-output").expect("write existing output");
        let source_hash_before = Sha256::digest(std::fs::read(&source).expect("read source"));

        let stopped = copy_renamed_file(&source, &directory, "归档-{n}", 0, "stop");
        assert!(stopped.is_err());
        assert_eq!(
            std::fs::read(&preferred).expect("read existing output"),
            b"existing-output"
        );

        let (output_name, output) = copy_renamed_file(&source, &directory, "归档-{n}", 0, "rename")
            .expect("copy with renamed conflict output");
        assert_eq!(output_name, "归档-01 (1).txt");
        assert_eq!(
            std::fs::read(&output).expect("read copied output"),
            b"source-content"
        );
        let source_hash_after = Sha256::digest(std::fs::read(&source).expect("read source"));
        assert_eq!(source_hash_before, source_hash_after);

        std::fs::remove_dir_all(&directory).expect("remove test directory");
    }

    #[test]
    fn network_job_cancellation_is_scoped_and_released() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let request_id = format!("test-network-cancel-{nonce}");
        let registration = register_network_job(Some(&request_id))
            .expect("register network job")
            .expect("registration should exist");
        assert!(!network_job_canceled(&Some(registration.token.clone())));
        assert!(cancel_network_job(request_id.clone()));
        assert!(network_job_canceled(&Some(registration.token.clone())));
        drop(registration);

        let pending_id = format!("{request_id}-pending");
        assert!(cancel_network_job(pending_id.clone()));
        let second = register_network_job(Some(&pending_id))
            .expect("register after pre-cancellation")
            .expect("second registration should exist");
        assert!(network_job_canceled(&Some(second.token.clone())));
        drop(second);
        assert!(cancel_network_job(pending_id));
    }

    #[test]
    fn network_job_registration_rejects_duplicate_and_preserves_generation_scope() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let request_id = format!("test-network-generation-{nonce}");
        let first = register_network_job(Some(&request_id))
            .expect("register network job")
            .expect("registration should exist");
        assert!(register_network_job(Some(&request_id)).is_err());

        let stale_token = first.token.clone();
        let stale_generation = first.generation;
        drop(first);
        let second = register_network_job(Some(&request_id))
            .expect("register replacement job")
            .expect("replacement registration should exist");
        unregister_network_job(&request_id, stale_generation, &stale_token);
        assert!(cancel_network_job(request_id.clone()));
        assert!(network_job_canceled(&Some(second.token.clone())));
        drop(second);
        assert!(cancel_network_job(request_id));
    }

    #[test]
    fn empty_network_request_ids_do_not_create_cancellation_entries() {
        assert!(register_network_job(Some(" "))
            .expect("empty id registration")
            .is_none());
        assert!(!cancel_network_job(" ".into()));
    }

    #[test]
    fn probe_port_detects_local_listener_and_rejects_zero_port() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind local probe listener");
        let port = listener
            .local_addr()
            .expect("read local probe address")
            .port();
        let result =
            tauri::async_runtime::block_on(probe_port("127.0.0.1".into(), port, 5_000, None))
                .expect("local listener should be reachable");
        assert!(result.success);
        assert!(
            tauri::async_runtime::block_on(probe_port("127.0.0.1".into(), 0, 5_000, None,))
                .is_err()
        );
    }

    #[test]
    fn relay_url_validation_and_endpoint_resolution_are_bounded() {
        let base = validate_relay_url(" https://relay.example/v1/// ").expect("valid relay URL");
        assert_eq!(base.as_str(), "https://relay.example/v1");
        let root = validate_relay_url("https://catbee.online").expect("root relay URL");
        assert_eq!(root.as_str(), "https://catbee.online/v1");
        assert_eq!(
            relay_endpoint(&base, "/chat/completions")
                .expect("chat endpoint")
                .as_str(),
            "https://relay.example/v1/chat/completions"
        );
        assert!(validate_relay_url("ftp://relay.example/v1").is_err());
        assert!(validate_relay_url("https://user:pass@relay.example/v1").is_err());
        assert!(validate_relay_url("https://relay.example/v1?token=secret").is_err());
    }

    #[test]
    fn relay_status_errors_keep_transient_and_auth_guidance_stable() {
        assert_eq!(
            relay_status_error(reqwest::StatusCode::UNAUTHORIZED),
            "中转站鉴权失败，请检查 API Key"
        );
        assert_eq!(
            relay_status_error(reqwest::StatusCode::NOT_FOUND),
            "中转站接口不存在，请确认 Base URL 包含正确的 /v1 路径"
        );
        assert_eq!(
            relay_status_error(reqwest::StatusCode::TOO_MANY_REQUESTS),
            "中转站请求过于频繁，请稍后重试"
        );
        assert_eq!(
            relay_status_error(reqwest::StatusCode::SERVICE_UNAVAILABLE),
            "中转站服务暂时不可用（HTTP 503）"
        );
        assert_eq!(
            relay_status_error(reqwest::StatusCode::BAD_REQUEST),
            "中转站返回 HTTP 400"
        );
    }

    #[test]
    fn relay_retry_policy_is_bounded_and_honors_retry_after() {
        assert!(relay_status_is_retryable(
            reqwest::StatusCode::TOO_MANY_REQUESTS
        ));
        assert!(relay_status_is_retryable(
            reqwest::StatusCode::SERVICE_UNAVAILABLE
        ));
        assert!(!relay_status_is_retryable(reqwest::StatusCode::BAD_REQUEST));

        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::RETRY_AFTER,
            reqwest::header::HeaderValue::from_static("1"),
        );
        assert_eq!(relay_retry_delay(&headers, 0), Duration::from_secs(1));
        assert_eq!(
            relay_retry_delay(&reqwest::header::HeaderMap::new(), 0),
            Duration::from_millis(250)
        );
        assert_eq!(
            relay_retry_delay(&reqwest::header::HeaderMap::new(), 8),
            Duration::from_secs(2)
        );
    }

    #[test]
    fn relay_response_text_supports_string_and_content_parts() {
        let string_content = serde_json::json!({
            "choices": [{"message": {"content": "  已完成  "}}]
        });
        assert_eq!(relay_response_text(&string_content), "已完成");
        let parts = serde_json::json!({
            "choices": [{"message": {"content": [{"type": "text", "text": "第一段"}, {"text": "第二段"}]}}]
        });
        assert_eq!(relay_response_text(&parts), "第一段第二段");
        assert!(relay_response_text(&serde_json::json!({"choices": []})).is_empty());
    }

    #[test]
    fn ccswitch_deep_link_extraction_is_bounded_and_path_scoped() {
        let link = "ccswitch://v1/import?resource=provider&apiKey=sk-test&model=gpt-test";
        let args = vec!["efficiency_toolbox", "--ignored", link, "--other"];
        assert_eq!(extract_ccswitch_deep_link(args), Some(link.to_string()));

        let wrong_scheme = vec!["efficiency_toolbox", "https://v1/import?resource=provider"];
        assert_eq!(extract_ccswitch_deep_link(wrong_scheme), None);
        let wrong_path = vec![
            "efficiency_toolbox",
            "ccswitch://v1/export?resource=provider",
        ];
        assert_eq!(extract_ccswitch_deep_link(wrong_path), None);

        let oversized = format!(
            "ccswitch://v1/import?payload={}",
            "x".repeat(MAX_CCSWITCH_DEEPLINK_LENGTH)
        );
        assert_eq!(
            extract_ccswitch_deep_link(vec!["efficiency_toolbox", &oversized]),
            None
        );
    }

    #[test]
    fn relay_http_client_round_trip_uses_openai_contract() {
        let (base_url, server) = spawn_relay_mock_server(vec![
            format!(r#"{{"data":[{{"id":"gpt-test"}},{{"id":"{}"}}]}}"#, "x".repeat(201)),
            r#"{"model":"gpt-test","choices":[{"message":{"content":"整理完成"}}],"usage":{"total_tokens":7}}"#.to_string(),
        ]);
        let connection = tauri::async_runtime::block_on(relay_test_connection(
            base_url.clone(),
            "".into(),
            "sk-local-test".into(),
            5_000,
            None,
        ))
        .expect("relay connection should succeed");
        assert_eq!(connection.model_count, 1);
        assert_eq!(connection.model, "");
        assert_eq!(connection.models, vec!["gpt-test"]);
        assert_eq!(connection.provider, "127.0.0.1");

        let chat = tauri::async_runtime::block_on(relay_chat(
            base_url,
            "gpt-test".into(),
            "sk-local-test".into(),
            vec![RelayMessage {
                role: "user".into(),
                content: "整理会议记录".into(),
            }],
            0.2,
            1024,
            5_000,
            None,
        ))
        .expect("relay chat should succeed");
        assert_eq!(chat.content, "整理完成");
        assert_eq!(chat.model, "gpt-test");
        assert_eq!(
            chat.usage
                .and_then(|usage| usage.get("total_tokens").cloned()),
            Some(serde_json::json!(7))
        );

        let requests = server.join().expect("relay mock server should finish");
        assert_eq!(requests.len(), 2);
        let connection_request = requests[0].to_ascii_lowercase();
        assert!(connection_request.starts_with("get /v1/models http/1.1"));
        assert!(connection_request.contains("authorization: bearer sk-local-test"));
        let chat_request = requests[1].to_ascii_lowercase();
        assert!(chat_request.starts_with("post /v1/chat/completions http/1.1"));
        assert!(chat_request.contains("authorization: bearer sk-local-test"));
        let (_, chat_body) = requests[1]
            .split_once("\r\n\r\n")
            .expect("chat request should contain an HTTP body");
        let chat_body: serde_json::Value =
            serde_json::from_str(chat_body).expect("chat request body should be JSON");
        assert_eq!(chat_body["model"], "gpt-test");
        assert_eq!(chat_body["messages"][0]["role"], "user");
        assert_eq!(chat_body["messages"][0]["content"], "整理会议记录");
    }

    #[test]
    fn ccswitch_sql_import_extracts_claude_and_codex_fields() {
        let claude_settings = serde_json::json!({
            "env": {
                "ANTHROPIC_BASE_URL": "https://claude.example/v1",
                "ANTHROPIC_AUTH_TOKEN": "sk-claude",
                "ANTHROPIC_MODEL": "claude-test"
            }
        });
        let codex_settings = serde_json::json!({
            "auth": { "OPENAI_API_KEY": "sk-codex" },
            "config": "base_url = \"https://codex.example/v1\"\nmodel = \"gpt-test\""
        });
        let sql = format!(
            "CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT); INSERT INTO providers VALUES ('claude-1', 'claude', 'Claude', '{}'), ('codex-1', 'codex', 'Codex', '{}');",
            claude_settings,
            codex_settings
        );
        let providers = parse_ccswitch_sql(&sql).expect("parse CC Switch SQL");
        assert_eq!(providers.len(), 2);
        assert_eq!(providers[0].name, "Claude");
        assert_eq!(providers[0].base_url, "https://claude.example/v1");
        assert_eq!(providers[0].api_key, "sk-claude");
        assert_eq!(providers[0].model, "claude-test");
        assert_eq!(providers[1].name, "Codex");
        assert_eq!(providers[1].base_url, "https://codex.example/v1");
        assert_eq!(providers[1].api_key, "sk-codex");
        assert_eq!(providers[1].model, "gpt-test");
    }

    #[test]
    fn ccswitch_sql_import_rejects_unsafe_and_empty_backups() {
        assert!(reject_unsafe_ccswitch_sql("ATTACH DATABASE 'x' AS other").is_err());
        assert!(reject_unsafe_ccswitch_sql("PRAGMA writable_schema=ON").is_err());
        let empty =
            "CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT);";
        assert!(parse_ccswitch_sql(empty).is_err());
    }

    #[test]
    fn ccswitch_file_import_enforces_extension_and_size_limits() {
        let directory = test_directory("ccswitch-file");
        let unsupported = directory.join("providers.txt");
        std::fs::write(&unsupported, b"not a database").expect("write unsupported file");
        assert!(read_ccswitch_file(&unsupported).is_err());

        let sql_path = directory.join("providers.sql");
        std::fs::write(
            &sql_path,
            "CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT); INSERT INTO providers VALUES ('id', 'codex', 'Test', '{\"base_url\":\"https://relay.example/v1\",\"apiKey\":\"sk-test\",\"model\":\"gpt-test\"}');",
        )
        .expect("write SQL backup");
        let providers = read_ccswitch_file(&sql_path).expect("read SQL backup");
        assert_eq!(providers.len(), 1);

        let db_path = directory.join("providers.db");
        {
            let connection = Connection::open(&db_path).expect("create CC Switch database");
            connection
                .execute_batch(
                    "CREATE TABLE providers (id TEXT, app_type TEXT, name TEXT, settings_config TEXT); INSERT INTO providers VALUES ('db-id', 'codex', 'Database provider', '{\"base_url\":\"https://db.example/v1\",\"apiKey\":\"sk-db\",\"model\":\"gpt-db\"}');",
                )
                .expect("seed CC Switch database");
        }
        let providers =
            read_ccswitch_file(&db_path).expect("read SQLite database in read-only mode");
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].name, "Database provider");
        assert_eq!(providers[0].base_url, "https://db.example/v1");
        assert_eq!(providers[0].model, "gpt-db");
        assert_eq!(providers[0].api_key, "sk-db");

        std::fs::remove_dir_all(&directory).expect("remove CC Switch test directory");
    }
}
