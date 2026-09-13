use serde::Serialize;
use std::{
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub const POWER_SAFETY_BUFFER_SECONDS: u64 = 30;
const MIN_POWER_DELAY_MS: i64 = (POWER_SAFETY_BUFFER_SECONDS as i64) * 1_000;
const MAX_POWER_DELAY_MS: i64 = 31 * 24 * 60 * 60 * 1_000;
const MAX_REQUEST_ID_LENGTH: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PowerAction {
    Shutdown,
    Restart,
    Hibernate,
}

impl PowerAction {
    fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "shutdown" => Ok(Self::Shutdown),
            "restart" => Ok(Self::Restart),
            "hibernate" => Ok(Self::Hibernate),
            _ => Err("仅支持关机、重启或休眠动作".into()),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Shutdown => "shutdown",
            Self::Restart => "restart",
            Self::Hibernate => "hibernate",
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PowerCapabilities {
    platform: String,
    scheduler: bool,
    supported_actions: Vec<&'static str>,
    safety_buffer_seconds: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PowerScheduleStatus {
    active: bool,
    request_id: Option<String>,
    action: Option<String>,
    execute_at_ms: Option<i64>,
    status: String,
    error: Option<String>,
}

struct ScheduleRecord {
    request_id: String,
    action: PowerAction,
    execute_at_ms: i64,
    cancel_token: Arc<AtomicBool>,
    status: String,
    error: Option<String>,
}

static POWER_SCHEDULE: OnceLock<Mutex<Option<ScheduleRecord>>> = OnceLock::new();

fn schedule_store() -> &'static Mutex<Option<ScheduleRecord>> {
    POWER_SCHEDULE.get_or_init(|| Mutex::new(None))
}

fn now_epoch_ms() -> Result<i64, String> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "系统时间无效，无法创建定时任务".to_string())?;
    i64::try_from(duration.as_millis()).map_err(|_| "系统时间超出支持范围".to_string())
}

fn validate_request_id(value: &str) -> Result<String, String> {
    let request_id = value.trim();
    if request_id.is_empty() || request_id.len() > MAX_REQUEST_ID_LENGTH {
        return Err("定时任务标识无效".into());
    }
    if !request_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err("定时任务标识包含不允许的字符".into());
    }
    Ok(request_id.to_string())
}

fn validate_execute_at(execute_at_ms: i64, now_ms: i64) -> Result<(), String> {
    let minimum = now_ms
        .checked_add(MIN_POWER_DELAY_MS)
        .ok_or_else(|| "定时任务时间超出支持范围".to_string())?;
    let maximum = now_ms
        .checked_add(MAX_POWER_DELAY_MS)
        .ok_or_else(|| "定时任务时间超出支持范围".to_string())?;
    if execute_at_ms < minimum {
        return Err(format!(
            "执行时间至少应晚于当前时间 {} 秒",
            POWER_SAFETY_BUFFER_SECONDS
        ));
    }
    if execute_at_ms > maximum {
        return Err("执行时间不能超过 31 天".into());
    }
    Ok(())
}

fn is_active(status: &str) -> bool {
    matches!(status, "scheduled" | "executing")
}

fn status_snapshot(record: Option<&ScheduleRecord>) -> PowerScheduleStatus {
    let Some(record) = record else {
        return PowerScheduleStatus {
            active: false,
            request_id: None,
            action: None,
            execute_at_ms: None,
            status: "idle".into(),
            error: None,
        };
    };
    PowerScheduleStatus {
        active: is_active(&record.status),
        request_id: Some(record.request_id.clone()),
        action: Some(record.action.id().into()),
        execute_at_ms: Some(record.execute_at_ms),
        status: record.status.clone(),
        error: record.error.clone(),
    }
}

fn update_status(
    request_id: &str,
    cancel_token: &Arc<AtomicBool>,
    status: &str,
    error: Option<String>,
) {
    if let Ok(mut guard) = schedule_store().lock() {
        if let Some(record) = guard.as_mut() {
            if record.request_id == request_id && Arc::ptr_eq(&record.cancel_token, cancel_token) {
                record.status = status.to_string();
                record.error = error;
            }
        }
    }
}

fn mark_executing(request_id: &str, cancel_token: &Arc<AtomicBool>) -> bool {
    let Ok(mut guard) = schedule_store().lock() else {
        return false;
    };
    let Some(record) = guard.as_mut() else {
        return false;
    };
    if record.request_id != request_id
        || !Arc::ptr_eq(&record.cancel_token, cancel_token)
        || record.status != "scheduled"
        || cancel_token.load(Ordering::Acquire)
    {
        return false;
    }
    record.status = "executing".into();
    record.error = None;
    true
}

fn remaining_until(target_ms: i64) -> Duration {
    let Ok(now_ms) = now_epoch_ms() else {
        return Duration::ZERO;
    };
    if target_ms <= now_ms {
        return Duration::ZERO;
    }
    Duration::from_millis((target_ms - now_ms) as u64)
}

#[cfg(target_os = "windows")]
fn execute_power_action(action: PowerAction) -> Result<(), String> {
    let mut command = Command::new("shutdown");
    match action {
        // The fixed 30-second timeout gives applications a save window. No force flag is used.
        PowerAction::Shutdown => {
            command.args(["/s", "/t", POWER_SAFETY_BUFFER_SECONDS.to_string().as_str()]);
        }
        PowerAction::Restart => {
            command.args(["/r", "/t", POWER_SAFETY_BUFFER_SECONDS.to_string().as_str()]);
        }
        PowerAction::Hibernate => {
            command.arg("/h");
        }
    }
    let output = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|_| "无法启动 Windows 电源命令".to_string())?;
    if output.status.success() {
        return Ok(());
    }
    Err("Windows 拒绝执行该电源动作，请检查系统权限和电源策略".into())
}

#[cfg(not(target_os = "windows"))]
fn execute_power_action(_action: PowerAction) -> Result<(), String> {
    Err("当前桌面环境暂不支持 Windows 电源动作".into())
}

fn wait_for_hibernate_buffer(cancel_token: &Arc<AtomicBool>) -> bool {
    let deadline = std::time::Instant::now() + Duration::from_secs(POWER_SAFETY_BUFFER_SECONDS);
    while std::time::Instant::now() < deadline {
        if cancel_token.load(Ordering::Acquire) {
            return false;
        }
        thread::sleep(Duration::from_millis(250));
    }
    !cancel_token.load(Ordering::Acquire)
}

#[tauri::command]
pub fn power_capabilities() -> PowerCapabilities {
    PowerCapabilities {
        platform: std::env::consts::OS.to_string(),
        scheduler: cfg!(target_os = "windows"),
        supported_actions: if cfg!(target_os = "windows") {
            vec!["shutdown", "restart", "hibernate"]
        } else {
            Vec::new()
        },
        safety_buffer_seconds: POWER_SAFETY_BUFFER_SECONDS,
    }
}

#[tauri::command]
pub fn power_schedule_status() -> PowerScheduleStatus {
    schedule_store()
        .lock()
        .map(|guard| status_snapshot(guard.as_ref()))
        .unwrap_or_else(|_| PowerScheduleStatus {
            active: false,
            request_id: None,
            action: None,
            execute_at_ms: None,
            status: "failed".into(),
            error: Some("定时任务状态不可用".into()),
        })
}

#[tauri::command]
pub fn schedule_power_action(
    action: String,
    execute_at_ms: i64,
    request_id: String,
) -> Result<PowerScheduleStatus, String> {
    if !cfg!(target_os = "windows") {
        return Err("当前桌面环境暂不支持 Windows 电源动作".into());
    }
    let action = PowerAction::parse(&action)?;
    let request_id = validate_request_id(&request_id)?;
    let now_ms = now_epoch_ms()?;
    validate_execute_at(execute_at_ms, now_ms)?;
    let cancel_token = Arc::new(AtomicBool::new(false));
    {
        let mut guard = schedule_store()
            .lock()
            .map_err(|_| "定时任务状态不可用".to_string())?;
        if guard
            .as_ref()
            .is_some_and(|record| is_active(&record.status))
        {
            return Err("已有一个定时任务在运行，请先取消后再创建".into());
        }
        *guard = Some(ScheduleRecord {
            request_id: request_id.clone(),
            action,
            execute_at_ms,
            cancel_token: cancel_token.clone(),
            status: "scheduled".into(),
            error: None,
        });
    }

    let worker_request_id = request_id.clone();
    let worker_cancel_token = Arc::clone(&cancel_token);
    let worker = thread::Builder::new()
        .name("power-schedule".into())
        .spawn(move || {
            loop {
                if worker_cancel_token.load(Ordering::Acquire) {
                    update_status(&worker_request_id, &worker_cancel_token, "canceled", None);
                    return;
                }
                let remaining = remaining_until(execute_at_ms);
                if remaining.is_zero() {
                    break;
                }
                thread::sleep(remaining.min(Duration::from_millis(500)));
            }
            if worker_cancel_token.load(Ordering::Acquire) {
                update_status(&worker_request_id, &worker_cancel_token, "canceled", None);
                return;
            }
            if !mark_executing(&worker_request_id, &worker_cancel_token) {
                return;
            }
            if action == PowerAction::Hibernate && !wait_for_hibernate_buffer(&worker_cancel_token)
            {
                update_status(&worker_request_id, &worker_cancel_token, "canceled", None);
                return;
            }
            match execute_power_action(action) {
                Ok(()) => update_status(&worker_request_id, &worker_cancel_token, "executed", None),
                Err(error) => update_status(
                    &worker_request_id,
                    &worker_cancel_token,
                    "failed",
                    Some(error),
                ),
            }
        });
    if worker.is_err() {
        update_status(
            &request_id,
            &cancel_token,
            "failed",
            Some("无法启动定时任务线程".into()),
        );
        return Err("无法启动定时任务线程".into());
    }
    Ok(power_schedule_status())
}

#[tauri::command]
pub fn cancel_power_schedule(request_id: Option<String>) -> Result<PowerScheduleStatus, String> {
    let requested_id = request_id.as_deref().map(validate_request_id).transpose()?;
    let mut guard = schedule_store()
        .lock()
        .map_err(|_| "定时任务状态不可用".to_string())?;
    let Some(record) = guard.as_mut() else {
        return Err("当前没有可取消的定时任务".into());
    };
    if let Some(requested_id) = requested_id {
        if requested_id != record.request_id {
            return Err("定时任务标识不匹配，未执行取消".into());
        }
    }
    if record.status != "scheduled" {
        return Err(if record.status == "executing" {
            "电源动作已进入执行阶段，无法取消".into()
        } else {
            "当前没有可取消的定时任务".into()
        });
    }
    record.cancel_token.store(true, Ordering::Release);
    record.status = "canceled".into();
    record.error = None;
    Ok(status_snapshot(Some(record)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_parser_accepts_only_fixed_values() {
        assert_eq!(PowerAction::parse("shutdown").unwrap().id(), "shutdown");
        assert_eq!(PowerAction::parse(" RESTART ").unwrap().id(), "restart");
        assert_eq!(PowerAction::parse("hibernate").unwrap().id(), "hibernate");
        assert!(PowerAction::parse("shutdown /f").is_err());
        assert!(PowerAction::parse("powershell").is_err());
    }

    #[test]
    fn request_id_validation_rejects_injection_like_values() {
        assert!(validate_request_id("power-abc_123").is_ok());
        assert!(validate_request_id("power; shutdown").is_err());
        assert!(validate_request_id(" ").is_err());
        assert!(validate_request_id(&"x".repeat(MAX_REQUEST_ID_LENGTH + 1)).is_err());
    }

    #[test]
    fn execute_time_requires_buffer_and_stays_within_window() {
        let now = 1_000_000_i64;
        assert!(validate_execute_at(now + MIN_POWER_DELAY_MS - 1, now).is_err());
        assert!(validate_execute_at(now + MIN_POWER_DELAY_MS, now).is_ok());
        assert!(validate_execute_at(now + MAX_POWER_DELAY_MS + 1, now).is_err());
    }

    #[test]
    fn empty_status_is_idle_and_inactive() {
        let status = status_snapshot(None);
        assert_eq!(status.status, "idle");
        assert!(!status.active);
        assert!(status.request_id.is_none());
    }
}
