use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::PathBuf, process::Command};
use tauri::{AppHandle, Manager};

const TASK_PREFIX: &str = "EfficiencyToolbox.Reminder.";
const MAX_ID_LENGTH: usize = 80;
const REMINDER_FIRE_ENV: &str = "EFFICIENCY_REMINDER_FIRE_ID";

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReminderScheduleInput {
    pub id: String,
    pub execute_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderSchedulerResult {
    pub supported: bool,
    pub scheduled: usize,
    pub canceled: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize, Default)]
struct ScheduleManifest {
    ids: Vec<String>,
}

fn validate_id(value: &str) -> Result<String, String> {
    let id = value.trim();
    if id.is_empty() || id.len() > MAX_ID_LENGTH {
        return Err("提醒任务标识无效".into());
    }
    if !id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("提醒任务标识包含不允许的字符".into());
    }
    Ok(id.to_string())
}

/// Detect the one-shot command line used by Windows Task Scheduler.
/// The value is copied into a process environment variable so the webview can
/// consume it through an allow-listed Tauri command without exposing arbitrary
/// command-line arguments to the frontend.
fn reminder_fire_id_from_args<I, S>(arguments: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut arguments = arguments
        .into_iter()
        .map(|argument| argument.as_ref().to_string());
    while let Some(argument) = arguments.next() {
        if argument != "--reminder-fire" {
            continue;
        }
        let candidate = arguments.next()?;
        return validate_id(&candidate).ok();
    }
    None
}

pub fn configure_reminder_fire_mode() -> bool {
    std::env::remove_var(REMINDER_FIRE_ENV);
    if let Some(id) = reminder_fire_id_from_args(std::env::args().skip(1)) {
        std::env::set_var(REMINDER_FIRE_ENV, id);
        return true;
    }
    false
}

pub fn reminder_fire_mode_enabled() -> bool {
    std::env::var(REMINDER_FIRE_ENV)
        .ok()
        .and_then(|value| validate_id(&value).ok())
        .is_some()
}

fn parse_local_datetime(value: &str) -> Result<(String, String), String> {
    let trimmed = value.trim();
    let (date, time) = trimmed
        .split_once('T')
        .ok_or_else(|| "提醒时间必须使用 YYYY-MM-DDTHH:mm 格式".to_string())?;
    let date_parts: Vec<&str> = date.split('-').collect();
    let time_parts: Vec<&str> = time.split(':').collect();
    if date_parts.len() != 3 || time_parts.len() != 2 {
        return Err("提醒时间格式无效".into());
    }
    let year: u16 = date_parts[0]
        .parse()
        .map_err(|_| "提醒年份无效".to_string())?;
    let month: u8 = date_parts[1]
        .parse()
        .map_err(|_| "提醒月份无效".to_string())?;
    let day: u8 = date_parts[2]
        .parse()
        .map_err(|_| "提醒日期无效".to_string())?;
    let hour: u8 = time_parts[0]
        .parse()
        .map_err(|_| "提醒小时无效".to_string())?;
    let minute: u8 = time_parts[1]
        .parse()
        .map_err(|_| "提醒分钟无效".to_string())?;
    if !(2020..=9999).contains(&year) || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err("提醒日期超出支持范围".into());
    }
    if hour > 23 || minute > 59 {
        return Err("提醒时间超出支持范围".into());
    }
    Ok((
        format!("{month:02}/{day:02}/{year:04}"),
        format!("{hour:02}:{minute:02}"),
    ))
}

fn task_name(id: &str) -> Result<String, String> {
    Ok(format!("{TASK_PREFIX}{}", validate_id(id)?))
}

fn manifest_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位提醒调度目录: {error}"))?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建提醒调度目录: {error}"))?;
    Ok(directory.join("reminder-scheduler.json"))
}

fn read_manifest(app: &AppHandle) -> Result<ScheduleManifest, String> {
    let path = manifest_path(app)?;
    if !path.is_file() {
        return Ok(ScheduleManifest::default());
    }
    let text =
        fs::read_to_string(path).map_err(|error| format!("无法读取提醒调度清单: {error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("提醒调度清单格式无效: {error}"))
}

fn write_manifest(app: &AppHandle, manifest: &ScheduleManifest) -> Result<(), String> {
    let path = manifest_path(app)?;
    let text = serde_json::to_string_pretty(manifest).map_err(|error| error.to_string())?;
    fs::write(path, format!("{text}\n")).map_err(|error| format!("无法保存提醒调度清单: {error}"))
}

#[cfg(windows)]
fn delete_task(id: &str) -> Result<(), String> {
    let name = task_name(id)?;
    let output = Command::new("schtasks.exe")
        .args(["/Delete", "/TN", &name, "/F"])
        .output()
        .map_err(|error| format!("无法调用 schtasks: {error}"))?;
    if output.status.success() || String::from_utf8_lossy(&output.stderr).contains("does not exist")
    {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(not(windows))]
fn delete_task(_id: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn create_task(id: &str, execute_at: &str) -> Result<(), String> {
    let name = task_name(id)?;
    let (date, time) = parse_local_datetime(execute_at)?;
    let executable =
        std::env::current_exe().map_err(|error| format!("无法定位应用程序: {error}"))?;
    let action = format!(
        "\"{}\" --reminder-fire {}",
        executable.display(),
        validate_id(id)?
    );
    let output = Command::new("schtasks.exe")
        .args([
            "/Create", "/TN", &name, "/SC", "ONCE", "/SD", &date, "/ST", &time, "/TR", &action,
            "/RL", "LIMITED", "/F",
        ])
        .output()
        .map_err(|error| format!("无法调用 schtasks: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(not(windows))]
fn create_task(_id: &str, _execute_at: &str) -> Result<(), String> {
    Err("当前平台不支持 Windows Task Scheduler".into())
}

#[tauri::command]
pub fn reminder_scheduler_capabilities() -> ReminderSchedulerResult {
    ReminderSchedulerResult {
        supported: cfg!(windows),
        scheduled: 0,
        canceled: 0,
        errors: Vec::new(),
    }
}

#[tauri::command]
pub fn reminder_fire_context() -> Option<String> {
    std::env::var(REMINDER_FIRE_ENV)
        .ok()
        .and_then(|value| validate_id(&value).ok())
}

#[tauri::command]
pub fn complete_reminder_fire(app: AppHandle) -> Result<(), String> {
    if !reminder_fire_mode_enabled() {
        return Err("当前不是提醒单次唤起模式".into());
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn reconcile_reminder_schedules(
    app: AppHandle,
    schedules: Vec<ReminderScheduleInput>,
) -> Result<ReminderSchedulerResult, String> {
    if !cfg!(windows) {
        return Ok(ReminderSchedulerResult {
            supported: false,
            scheduled: 0,
            canceled: 0,
            errors: vec!["当前平台不支持 Windows Task Scheduler".into()],
        });
    }

    let previous = read_manifest(&app)?;
    let mut current_ids = HashSet::new();
    let mut result = ReminderSchedulerResult {
        supported: true,
        scheduled: 0,
        canceled: 0,
        errors: Vec::new(),
    };

    for schedule in schedules {
        let id = validate_id(&schedule.id)?;
        current_ids.insert(id.clone());
        if let Err(error) = create_task(&id, &schedule.execute_at) {
            result.errors.push(format!("{id}: {error}"));
        } else {
            result.scheduled += 1;
        }
    }
    for old_id in previous.ids {
        if current_ids.contains(&old_id) {
            continue;
        }
        if let Err(error) = delete_task(&old_id) {
            result.errors.push(format!("{old_id}: {error}"));
        } else {
            result.canceled += 1;
        }
    }

    write_manifest(
        &app,
        &ScheduleManifest {
            ids: current_ids.into_iter().collect(),
        },
    )?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_datetime_is_converted_to_schtasks_format() {
        assert_eq!(
            parse_local_datetime("2026-09-18T09:05").expect("valid time"),
            ("09/18/2026".to_string(), "09:05".to_string())
        );
    }

    #[test]
    fn reminder_task_ids_are_bounded_and_shell_safe() {
        assert_eq!(
            task_name("reminder-1").expect("valid id"),
            "EfficiencyToolbox.Reminder.reminder-1"
        );
        assert!(task_name("bad id").is_err());
        assert!(task_name(&"x".repeat(MAX_ID_LENGTH + 1)).is_err());
    }

    #[test]
    fn reminder_fire_arguments_are_strictly_validated() {
        assert_eq!(
            reminder_fire_id_from_args(["--other", "x", "--reminder-fire", "abc-1"]),
            Some("abc-1".to_string())
        );
        assert_eq!(
            reminder_fire_id_from_args(["--reminder-fire", "bad id"]),
            None
        );
        assert_eq!(reminder_fire_id_from_args(["--reminder-fire"]), None);
    }
}
