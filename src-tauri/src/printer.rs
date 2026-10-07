use base64::Engine;
use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const MAX_PRINT_BYTES: usize = 64 * 1024 * 1024;
const MAX_PRINTER_NAME_LENGTH: usize = 512;
const STALE_PRINT_FILE_AGE: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintSubmission {
    pub printer_name: String,
    pub method: String,
    pub file_type: String,
}

fn normalize_printer_name(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > MAX_PRINTER_NAME_LENGTH || value.contains('\0') || value.contains('"') {
        return Err("打印机名称无效".into());
    }
    Ok(Some(value.to_string()))
}

fn file_extension(file_name: &str) -> &'static str {
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "pdf" => "pdf",
        "png" => "png",
        "jpg" | "jpeg" => "jpg",
        "webp" => "webp",
        "txt" => "txt",
        "html" | "htm" => "html",
        _ => "bin",
    }
}

fn cleanup_stale_files(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        if now
            .duration_since(modified)
            .map(|age| age > STALE_PRINT_FILE_AGE)
            .unwrap_or(false)
        {
            let _ = fs::remove_file(path);
        }
    }
}

fn create_print_file(file_name: &str, content_base64: &str) -> Result<(PathBuf, String), String> {
    if content_base64.len() > (MAX_PRINT_BYTES * 4 / 3) + 16 {
        return Err("打印文件超过 64 MB 限制".into());
    }
    let content = base64::engine::general_purpose::STANDARD
        .decode(content_base64)
        .map_err(|_| "打印文件内容编码无效".to_string())?;
    if content.is_empty() {
        return Err("打印文件不能为空".into());
    }
    if content.len() > MAX_PRINT_BYTES {
        return Err("打印文件超过 64 MB 限制".into());
    }

    let directory = std::env::temp_dir().join("efficiency-toolbox-print");
    fs::create_dir_all(&directory).map_err(|_| "无法创建本地打印临时目录".to_string())?;
    cleanup_stale_files(&directory);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "系统时间无效，无法创建打印任务".to_string())?
        .as_nanos();
    let extension = file_extension(file_name);
    let path = directory.join(format!("job-{}-{nonce}.{extension}", std::process::id()));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|_| "无法创建打印临时文件".to_string())?;
    file.write_all(&content)
        .map_err(|_| "无法写入打印临时文件".to_string())?;
    file.flush()
        .map_err(|_| "无法完成打印临时文件写入".to_string())?;
    Ok((path, extension.to_string()))
}

#[cfg(windows)]
fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn wide_str(value: &str) -> Vec<u16> {
    wide(std::ffi::OsStr::new(value))
}

#[cfg(windows)]
fn wide_ptr_to_string(value: *const u16) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let mut length = 0usize;
    unsafe {
        while *value.add(length) != 0 {
            length += 1;
        }
        String::from_utf16(&std::slice::from_raw_parts(value, length))
            .ok()
            .filter(|text| !text.trim().is_empty())
    }
}

#[cfg(windows)]
fn default_printer_name() -> Option<String> {
    use windows_sys::Win32::Graphics::Printing::GetDefaultPrinterW;
    let mut required = 0u32;
    unsafe {
        let _ = GetDefaultPrinterW(std::ptr::null_mut(), &mut required);
    }
    if required == 0 {
        return None;
    }
    let mut buffer = vec![0u16; required as usize];
    let mut length = required;
    let success = unsafe { GetDefaultPrinterW(buffer.as_mut_ptr(), &mut length) } != 0;
    if !success {
        return None;
    }
    let length = length.saturating_sub(1) as usize;
    String::from_utf16(&buffer[..length]).ok()
}

#[cfg(windows)]
fn platform_list_printers() -> Result<Vec<PrinterInfo>, String> {
    use windows_sys::Win32::Graphics::Printing::{EnumPrintersW, PRINTER_INFO_4W};

    const PRINTER_ENUM_LOCAL: u32 = 0x00000002;
    const PRINTER_ENUM_CONNECTIONS: u32 = 0x00000004;
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let mut required = 0u32;
    let mut returned = 0u32;
    unsafe {
        let _ = EnumPrintersW(
            flags,
            std::ptr::null(),
            4,
            std::ptr::null_mut(),
            0,
            &mut required,
            &mut returned,
        );
    }
    if required == 0 {
        return Ok(default_printer_name()
            .map(|name| {
                vec![PrinterInfo {
                    is_default: true,
                    name,
                }]
            })
            .unwrap_or_default());
    }
    let buffer_bytes = required as usize;
    let word_size = std::mem::size_of::<usize>();
    let word_count = buffer_bytes.div_ceil(word_size);
    let mut buffer = vec![0usize; word_count];
    let success = unsafe {
        EnumPrintersW(
            flags,
            std::ptr::null(),
            4,
            buffer.as_mut_ptr().cast::<u8>(),
            buffer_bytes as u32,
            &mut required,
            &mut returned,
        )
    } != 0;
    if !success {
        return Err("Windows 无法读取本机打印机列表".into());
    }
    let entries_bytes = (returned as usize)
        .checked_mul(std::mem::size_of::<PRINTER_INFO_4W>())
        .ok_or_else(|| "Windows 返回的打印机列表大小无效".to_string())?;
    if entries_bytes > buffer_bytes {
        return Err("Windows 返回的打印机列表超出缓冲区".into());
    }

    let default_name = default_printer_name();
    let entries = unsafe {
        std::slice::from_raw_parts(buffer.as_ptr().cast::<PRINTER_INFO_4W>(), returned as usize)
    };
    let mut printers = entries
        .iter()
        .filter_map(|entry| wide_ptr_to_string(entry.pPrinterName))
        .map(|name| PrinterInfo {
            is_default: default_name.as_deref() == Some(name.as_str()),
            name,
        })
        .collect::<Vec<_>>();
    printers.sort_by(|left, right| {
        right
            .is_default
            .cmp(&left.is_default)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    printers.dedup_by(|left, right| left.name == right.name);
    Ok(printers)
}

#[cfg(not(windows))]
fn platform_list_printers() -> Result<Vec<PrinterInfo>, String> {
    Err("当前桌面环境暂不支持 Windows 本地打印机接口".into())
}

#[cfg(windows)]
fn shell_print(path: &Path, printer_name: Option<&str>) -> Result<(String, String), String> {
    use windows_sys::Win32::UI::{
        Shell::ShellExecuteW,
        WindowsAndMessaging::{SW_HIDE, SW_SHOWNORMAL},
    };

    let path_wide = wide(path.as_os_str());
    let default_name = default_printer_name();
    let selected = printer_name
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let attempts = if selected.is_some() {
        vec!["printto", "print"]
    } else {
        vec!["print"]
    };
    for verb in attempts {
        if verb == "print" && selected.is_some() && default_name.as_deref() != selected {
            continue;
        }
        let verb_wide = wide_str(verb);
        let parameters = selected.map(|value| wide_str(&format!("\"{value}\"")));
        let parameters_ptr = parameters
            .as_ref()
            .map(|value| value.as_ptr())
            .unwrap_or(std::ptr::null());
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb_wide.as_ptr(),
                path_wide.as_ptr(),
                parameters_ptr,
                std::ptr::null(),
                if verb == "printto" {
                    SW_HIDE
                } else {
                    SW_SHOWNORMAL
                },
            )
        };
        if (result as usize) > 32 {
            let printer = selected
                .map(ToOwned::to_owned)
                .or(default_name)
                .unwrap_or_else(|| "系统默认打印机".into());
            return Ok((printer, verb.into()));
        }
    }
    Err("Windows 未找到该文件类型的本地打印处理程序；请检查默认应用或改用浏览器打印".into())
}

#[cfg(not(windows))]
fn shell_print(_path: &Path, _printer_name: Option<&str>) -> Result<(String, String), String> {
    Err("当前桌面环境暂不支持 Windows 本地打印机接口".into())
}

#[tauri::command]
pub fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    platform_list_printers()
}

#[tauri::command]
pub fn print_file(
    file_name: String,
    content_base64: String,
    printer_name: Option<String>,
) -> Result<PrintSubmission, String> {
    let printer_name = normalize_printer_name(printer_name.as_deref())?;
    let (path, file_type) = create_print_file(&file_name, &content_base64)?;
    match shell_print(&path, printer_name.as_deref()) {
        Ok((printer_name, method)) => Ok(PrintSubmission {
            printer_name,
            method,
            file_type,
        }),
        Err(error) => {
            let _ = fs::remove_file(path);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn printer_names_are_trimmed_and_restricted() {
        assert_eq!(normalize_printer_name(None).unwrap(), None);
        assert_eq!(
            normalize_printer_name(Some("  Office  ")).unwrap(),
            Some("Office".into())
        );
        assert!(normalize_printer_name(Some("bad\"name")).is_err());
        assert!(normalize_printer_name(Some(&"x".repeat(MAX_PRINTER_NAME_LENGTH + 1))).is_err());
    }

    #[test]
    fn file_extension_is_allowlisted() {
        assert_eq!(file_extension("report.PDF"), "pdf");
        assert_eq!(file_extension("photo.jpeg"), "jpg");
        assert_eq!(file_extension("unknown.exe"), "bin");
    }

    #[test]
    fn print_payload_is_decoded_and_bounded() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(b"hello");
        let (path, extension) = create_print_file("note.txt", &encoded).unwrap();
        assert_eq!(extension, "txt");
        assert_eq!(std::fs::read(&path).unwrap(), b"hello");
        std::fs::remove_file(path).unwrap();
        assert!(create_print_file("note.txt", "not-base64").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn windows_printer_enumeration_reads_the_local_spooler() {
        let printers = list_printers().expect("Windows printer enumeration should succeed");
        assert!(printers
            .iter()
            .all(|printer| !printer.name.trim().is_empty()));
    }
}
