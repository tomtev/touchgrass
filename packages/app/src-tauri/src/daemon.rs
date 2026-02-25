use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::net::UnixStream;

fn home_dir() -> Option<std::path::PathBuf> {
    dirs::home_dir()
}

fn read_auth_token() -> Result<String, String> {
    let path = home_dir()
        .ok_or("Cannot determine home directory")?
        .join(".touchgrass")
        .join("daemon.auth");
    std::fs::read_to_string(&path)
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("Failed to read auth token: {e}"))
}

fn http_request(method: &str, path: &str, body: Option<&str>) -> Result<String, String> {
    let token = read_auth_token()?;

    let sock_path = home_dir()
        .ok_or("Cannot determine home directory")?
        .join(".touchgrass")
        .join("daemon.sock");

    #[cfg(unix)]
    let mut stream =
        UnixStream::connect(&sock_path).map_err(|e| format!("Cannot connect to daemon: {e}"))?;

    #[cfg(not(unix))]
    let mut stream = {
        let port_path = home_dir()
            .ok_or("Cannot determine home directory")?
            .join(".touchgrass")
            .join("daemon.port");
        let port_str = std::fs::read_to_string(&port_path)
            .map_err(|e| format!("Failed to read daemon port: {e}"))?;
        let port: u16 = port_str
            .trim()
            .parse()
            .map_err(|e| format!("Invalid daemon port: {e}"))?;
        std::net::TcpStream::connect(("127.0.0.1", port))
            .map_err(|e| format!("Cannot connect to daemon: {e}"))?
    };

    // Shutdown write side after sending so server sees EOF and responds
    let body_bytes = body.unwrap_or("");
    let content_length = body_bytes.len();

    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: localhost\r\nx-touchgrass-auth: {token}\r\nContent-Type: application/json\r\nContent-Length: {content_length}\r\nConnection: close\r\n\r\n{body_bytes}"
    );

    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("Failed to send request: {e}"))?;

    // Read response using Content-Length to know when we're done
    // (avoids blocking on second read() waiting for server to close socket)
    let mut response = Vec::new();
    let mut buf = [0u8; 8192];
    let mut header_end: Option<usize> = None;
    let mut content_length: Option<usize> = None;

    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                response.extend_from_slice(&buf[..n]);

                // Try to find header end if we haven't yet
                if header_end.is_none() {
                    if let Some(pos) = find_header_end(&response) {
                        header_end = Some(pos);
                        // Parse Content-Length from headers
                        let hdr = String::from_utf8_lossy(&response[..pos]);
                        for line in hdr.split("\r\n") {
                            if let Some(val) = line.strip_prefix("Content-Length: ") {
                                content_length = val.trim().parse().ok();
                            } else if let Some(val) = line.strip_prefix("content-length: ") {
                                content_length = val.trim().parse().ok();
                            }
                        }
                    }
                }

                // If we know the full size, check if we have enough
                if let (Some(hdr_end), Some(cl)) = (header_end, content_length) {
                    let body_start = hdr_end + 4; // past \r\n\r\n
                    if response.len() >= body_start + cl {
                        break;
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => {
                if !response.is_empty() {
                    break;
                }
                return Err(format!("Failed to read response: {e}"));
            }
        }
    }
    let response = String::from_utf8(response)
        .map_err(|e| format!("Response is not valid UTF-8: {e}"))?;

    // Parse HTTP response - find body after \r\n\r\n
    let body_start = response
        .find("\r\n\r\n")
        .ok_or("Invalid HTTP response: no header/body separator")?;
    let headers = &response[..body_start];
    let body = &response[body_start + 4..];

    // Extract status code from first line
    let status_line = headers
        .lines()
        .next()
        .ok_or("Invalid HTTP response: no status line")?;
    let status_code: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or("Invalid HTTP response: cannot parse status code")?;

    // Handle chunked transfer encoding
    let response_body = if headers.contains("Transfer-Encoding: chunked") {
        decode_chunked(body)?
    } else {
        body.to_string()
    };

    if status_code >= 400 {
        // Try to extract error message from JSON body
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&response_body) {
            if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
                return Err(err.to_string());
            }
        }
        return Err(format!("HTTP {status_code}: {response_body}"));
    }

    Ok(response_body)
}

fn find_header_end(data: &[u8]) -> Option<usize> {
    data.windows(4).position(|w| w == b"\r\n\r\n")
}

fn decode_chunked(body: &str) -> Result<String, String> {
    let mut result = String::new();
    let mut remaining = body;

    loop {
        // Skip leading whitespace/newlines
        remaining = remaining.trim_start();
        if remaining.is_empty() {
            break;
        }

        // Find chunk size line
        let size_end = remaining
            .find("\r\n")
            .unwrap_or(remaining.len());
        let size_str = &remaining[..size_end];
        let chunk_size = usize::from_str_radix(size_str.trim(), 16)
            .map_err(|_| format!("Invalid chunk size: '{size_str}'"))?;

        if chunk_size == 0 {
            break;
        }

        // Move past the size line + \r\n
        let data_start = size_end + 2;
        if data_start + chunk_size > remaining.len() {
            // Grab what we can
            result.push_str(&remaining[data_start..]);
            break;
        }

        result.push_str(&remaining[data_start..data_start + chunk_size]);
        remaining = &remaining[data_start + chunk_size..];
    }

    Ok(result)
}

// --- Response types ---

#[derive(Debug, Serialize, Deserialize)]
pub struct HealthResponse {
    pub ok: bool,
    pub pid: Option<u64>,
    #[serde(rename = "startedAt")]
    pub started_at: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelSummary {
    pub name: String,
    #[serde(rename = "type")]
    pub channel_type: String,
    #[serde(rename = "botUsername")]
    pub bot_username: Option<String>,
    #[serde(rename = "botFirstName")]
    pub bot_first_name: Option<String>,
    #[serde(rename = "pairedUserCount")]
    pub paired_user_count: u32,
    #[serde(rename = "linkedGroupCount")]
    pub linked_group_count: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelListResponse {
    pub ok: bool,
    pub channels: Vec<ChannelSummary>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PairedUser {
    #[serde(rename = "userId")]
    pub user_id: String,
    pub username: Option<String>,
    #[serde(rename = "pairedAt")]
    pub paired_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LinkedGroup {
    #[serde(rename = "chatId")]
    pub chat_id: String,
    pub title: Option<String>,
    #[serde(rename = "linkedAt")]
    pub linked_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelDetails {
    pub name: String,
    #[serde(rename = "type")]
    pub channel_type: String,
    #[serde(rename = "botUsername")]
    pub bot_username: Option<String>,
    #[serde(rename = "pairedUsers")]
    pub paired_users: Vec<PairedUser>,
    #[serde(rename = "linkedGroups")]
    pub linked_groups: Vec<LinkedGroup>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelDetailResponse {
    pub ok: bool,
    pub channel: ChannelDetails,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AddChannelResponse {
    pub ok: bool,
    #[serde(rename = "botUsername")]
    pub bot_username: Option<String>,
    #[serde(rename = "botFirstName")]
    pub bot_first_name: Option<String>,
    #[serde(rename = "needsRestart")]
    pub needs_restart: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RemoveResponse {
    pub ok: bool,
    #[serde(rename = "needsRestart")]
    pub needs_restart: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateCodeResponse {
    pub ok: bool,
    pub code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SimpleResponse {
    pub ok: bool,
}

// --- Runtime channel info (from /channels endpoint) ---

#[derive(Debug, Serialize, Deserialize)]
pub struct RuntimeChannel {
    #[serde(rename = "chatId")]
    pub chat_id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub channel_type: String,
    pub busy: bool,
    #[serde(rename = "busyLabel")]
    pub busy_label: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RuntimeChannelsResponse {
    pub ok: bool,
    pub channels: Vec<RuntimeChannel>,
}

// --- Tauri commands ---

#[tauri::command]
pub fn daemon_health() -> Result<HealthResponse, String> {
    let body = http_request("GET", "/health", None)?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

#[tauri::command]
pub fn daemon_list_channels() -> Result<ChannelListResponse, String> {
    let body = http_request("GET", "/config/channels", None)?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

#[tauri::command]
pub fn daemon_runtime_channels() -> Result<RuntimeChannelsResponse, String> {
    let body = http_request("GET", "/channels", None)?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

#[tauri::command]
pub fn daemon_get_channel(name: String) -> Result<ChannelDetailResponse, String> {
    let path = format!("/config/channels/{name}");
    let body = http_request("GET", &path, None)?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

#[tauri::command]
pub fn daemon_add_channel(
    name: String,
    channel_type: String,
    bot_token: String,
) -> Result<AddChannelResponse, String> {
    let payload = serde_json::json!({
        "name": name,
        "type": channel_type,
        "botToken": bot_token,
    });
    let body = http_request("POST", "/config/channels", Some(&payload.to_string()))?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

#[tauri::command]
pub fn daemon_remove_channel(name: String) -> Result<RemoveResponse, String> {
    let path = format!("/config/channels/{name}");
    let body = http_request("DELETE", &path, None)?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

#[tauri::command]
pub fn daemon_remove_user(channel_name: String, user_id: String) -> Result<SimpleResponse, String> {
    let encoded_user_id = urlencoding(&user_id);
    let path = format!("/config/channels/{channel_name}/users/{encoded_user_id}");
    let body = http_request("DELETE", &path, None)?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

#[tauri::command]
pub fn daemon_remove_group(
    channel_name: String,
    chat_id: String,
) -> Result<SimpleResponse, String> {
    let encoded_chat_id = urlencoding(&chat_id);
    let path = format!("/config/channels/{channel_name}/groups/{encoded_chat_id}");
    let body = http_request("DELETE", &path, None)?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

#[tauri::command]
pub fn daemon_generate_code() -> Result<GenerateCodeResponse, String> {
    let body = http_request("POST", "/generate-code", Some("{}"))?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

#[tauri::command]
pub fn daemon_restart() -> Result<SimpleResponse, String> {
    // Send shutdown to current daemon (ignore errors — it may already be stopped)
    let _ = http_request("POST", "/shutdown", Some("{}"));

    // Wait for daemon to stop (up to 3 seconds)
    let pid_path = home_dir()
        .ok_or("Cannot determine home directory")?
        .join(".touchgrass")
        .join("daemon.pid");
    for _ in 0..30 {
        if !pid_path.exists() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    // Try installed binary first, then dev mode
    if let Some(tg_bin) = find_tg_binary() {
        std::process::Command::new(&tg_bin)
            .arg("channels")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start daemon: {e}"))?;
    } else if let Some((bun, main_ts)) = find_tg_dev() {
        let project_dir = main_ts.parent().and_then(|p| p.parent())
            .ok_or("Invalid dev path")?;
        std::process::Command::new(&bun)
            .args(["run", &main_ts.to_string_lossy(), "channels"])
            .current_dir(project_dir)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start daemon (dev): {e}"))?;
    } else {
        return Err("Cannot find touchgrass binary. Install it or ensure 'touchgrass' is in PATH.".to_string());
    }

    // Wait for daemon to become healthy (up to 5 seconds)
    for _ in 0..50 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if http_request("GET", "/health", None).is_ok() {
            return Ok(SimpleResponse { ok: true });
        }
    }

    Err("Daemon started but health check timed out".to_string())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InputNeededSession {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub command: String,
    #[serde(rename = "type")]
    pub input_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InputNeededResponse {
    pub ok: bool,
    pub sessions: Vec<InputNeededSession>,
}

#[tauri::command]
pub fn daemon_input_needed() -> Result<InputNeededResponse, String> {
    let body = http_request("GET", "/input-needed", None)?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecentSession {
    #[serde(rename = "sessionRef")]
    pub session_ref: String,
    pub label: String,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecentSessionsResponse {
    pub ok: bool,
    pub sessions: Vec<RecentSession>,
}

#[tauri::command]
pub fn daemon_recent_sessions(tool: String, cwd: String) -> Result<RecentSessionsResponse, String> {
    let encoded_tool = urlencoding(&tool);
    let encoded_cwd = urlencoding(&cwd);
    let path = format!("/sessions/recent?tool={encoded_tool}&cwd={encoded_cwd}");
    let body = http_request("GET", &path, None)?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

// --- Skills ---

#[derive(Debug, Serialize, Deserialize)]
pub struct SkillInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub scope: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SkillsResponse {
    pub ok: bool,
    pub skills: Vec<SkillInfo>,
}

#[tauri::command]
pub fn daemon_list_skills(cwd: String) -> Result<SkillsResponse, String> {
    let encoded_cwd = urlencoding(&cwd);
    let path = format!("/skills?cwd={encoded_cwd}");
    let body = http_request("GET", &path, None)?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

// --- Background jobs ---

#[derive(Debug, Serialize, Deserialize)]
pub struct BackgroundJob {
    #[serde(rename = "taskId")]
    pub task_id: String,
    pub status: String,
    pub command: Option<String>,
    pub urls: Option<Vec<String>>,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackgroundJobSession {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub command: String,
    pub cwd: String,
    pub jobs: Vec<BackgroundJob>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BackgroundJobsResponse {
    pub ok: bool,
    pub sessions: Vec<BackgroundJobSession>,
}

#[tauri::command]
pub fn daemon_list_background_jobs(cwd: String) -> Result<BackgroundJobsResponse, String> {
    let encoded_cwd = urlencoding(&cwd);
    let path = format!("/background-jobs?cwd={encoded_cwd}");
    let body = http_request("GET", &path, None)?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

// --- Agent Soul ---

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentSoul {
    pub name: String,
    pub purpose: String,
    pub owner: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dna: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AgentSoulResponse {
    pub ok: bool,
    pub soul: Option<AgentSoul>,
}

#[tauri::command]
pub fn daemon_get_agent_soul(cwd: String) -> Result<AgentSoulResponse, String> {
    let encoded_cwd = urlencoding(&cwd);
    let path = format!("/agent-soul?cwd={encoded_cwd}");
    let body = http_request("GET", &path, None)?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

#[tauri::command]
pub fn daemon_set_agent_soul(
    cwd: String,
    name: String,
    purpose: String,
    owner: String,
    dna: Option<String>,
) -> Result<SimpleResponse, String> {
    let encoded_cwd = urlencoding(&cwd);
    let path = format!("/agent-soul?cwd={encoded_cwd}");
    let mut payload = serde_json::json!({
        "name": name,
        "purpose": purpose,
        "owner": owner,
    });
    if let Some(d) = dna {
        payload["dna"] = serde_json::Value::String(d);
    }
    let body = http_request("POST", &path, Some(&payload.to_string()))?;
    serde_json::from_str(&body).map_err(|e| format!("Failed to parse response: {e}"))
}

pub(crate) fn find_tg_binary() -> Option<std::path::PathBuf> {
    // Check ~/.touchgrass/bin/touchgrass first (installed binary)
    if let Some(home) = home_dir() {
        let local_bin = home.join(".touchgrass").join("bin").join("touchgrass");
        if local_bin.exists() {
            return Some(local_bin);
        }
        // Fallback to legacy tg symlink
        let legacy_bin = home.join(".touchgrass").join("bin").join("tg");
        if legacy_bin.exists() {
            return Some(legacy_bin);
        }
    }

    // PATH lookup for `touchgrass`
    if let Ok(output) = std::process::Command::new("which").arg("touchgrass").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(std::path::PathBuf::from(path));
            }
        }
    }

    // Fallback: PATH lookup for `tg`
    if let Ok(output) = std::process::Command::new("which").arg("tg").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(std::path::PathBuf::from(path));
            }
        }
    }

    None
}

/// Find the touchgrass source directory for dev mode.
/// Returns (bun_path, main_ts_path) if found.
pub(crate) fn find_tg_dev() -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    if let Some(home) = home_dir() {
        // Common dev locations
        for dir in &["Dev/touchgrass", "src/touchgrass", "projects/touchgrass"] {
            let src_dir = home.join(dir);
            let main_ts = src_dir.join("src").join("main.ts");
            if main_ts.exists() {
                // Find bun
                if let Ok(output) = std::process::Command::new("which").arg("bun").output() {
                    if output.status.success() {
                        let bun = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        if !bun.is_empty() {
                            return Some((
                                std::path::PathBuf::from(bun),
                                main_ts,
                            ));
                        }
                    }
                }
            }
        }
    }
    None
}

/// Simple percent-encoding for URL path segments.
fn urlencoding(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(b as char);
            }
            _ => {
                result.push_str(&format!("%{b:02X}"));
            }
        }
    }
    result
}
