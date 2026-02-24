use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use tauri::{AppHandle, Emitter};

/// Lightweight HTTP server that receives Claude Code hook events from the
/// touchgrass hook script and emits them as Tauri events.
/// Also receives push events from the daemon (e.g., channel linked).
pub struct HookServer {
    pub port: u16,
}

#[derive(Clone, serde::Serialize)]
struct HookEvent {
    session_id: String,
    hook_event_name: String,
    tool_name: Option<String>,
    tool_input: Option<serde_json::Value>,
    /// Claude Code's own session ID (for --resume)
    claude_session_id: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct DaemonEvent {
    event_type: String,
    title: Option<String>,
    chat_id: Option<String>,
    username: Option<String>,
}

impl HookServer {
    pub fn start(app: AppHandle) -> Result<Self, String> {
        let listener =
            TcpListener::bind("127.0.0.1:0").map_err(|e| format!("Bind failed: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("Addr failed: {e}"))?
            .port();

        // Write app.port so the daemon can push events to us
        if let Some(home) = dirs::home_dir() {
            let port_path = home.join(".touchgrass").join("app.port");
            let _ = std::fs::write(&port_path, port.to_string());
        }

        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let app = app.clone();
                std::thread::spawn(move || handle_connection(stream, &app));
            }
        });

        Ok(HookServer { port })
    }
}

impl Drop for HookServer {
    fn drop(&mut self) {
        // Clean up app.port on shutdown
        if let Some(home) = dirs::home_dir() {
            let port_path = home.join(".touchgrass").join("app.port");
            let _ = std::fs::remove_file(&port_path);
        }
    }
}

fn handle_connection(mut stream: std::net::TcpStream, app: &AppHandle) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));

    let mut reader = BufReader::new(&stream);

    // Read request line: POST /hook/{sessionId} HTTP/1.1
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }

    let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
    if parts.len() < 2 || parts[0] != "POST" {
        let _ = write_response(&mut stream, 405, r#"{"error":"method not allowed"}"#);
        return;
    }

    let path = parts[1];

    // Handle daemon push events (POST /event)
    if path == "/event" {
        // Read headers to find Content-Length
        let mut content_length: usize = 0;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
                break;
            }
            if let Some(val) = line
                .to_lowercase()
                .strip_prefix("content-length:")
                .map(|v| v.trim().to_string())
            {
                content_length = val.parse().unwrap_or(0);
            }
        }

        let mut body = vec![0u8; content_length];
        if content_length > 0 && reader.read_exact(&mut body).is_err() {
            let _ = write_response(&mut stream, 400, r#"{"error":"bad body"}"#);
            return;
        }

        let json: serde_json::Value = match serde_json::from_slice(&body) {
            Ok(v) => v,
            Err(_) => {
                let _ = write_response(&mut stream, 400, r#"{"error":"invalid json"}"#);
                return;
            }
        };

        let event = DaemonEvent {
            event_type: json.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            title: json.get("title").and_then(|v| v.as_str()).map(String::from),
            chat_id: json.get("chatId").and_then(|v| v.as_str()).map(String::from),
            username: json.get("username").and_then(|v| v.as_str()).map(String::from),
        };

        let _ = app.emit("daemon-event", event);
        let _ = write_response(&mut stream, 200, r#"{"ok":true}"#);
        return;
    }

    let session_id = match path.strip_prefix("/hook/") {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => {
            let _ = write_response(&mut stream, 404, r#"{"error":"not found"}"#);
            return;
        }
    };

    // Read headers to find Content-Length
    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
            break;
        }
        if let Some(val) = line
            .to_lowercase()
            .strip_prefix("content-length:")
            .map(|v| v.trim().to_string())
        {
            content_length = val.parse().unwrap_or(0);
        }
    }

    // Read body
    let mut body = vec![0u8; content_length];
    if content_length > 0 && reader.read_exact(&mut body).is_err() {
        let _ = write_response(&mut stream, 400, r#"{"error":"bad body"}"#);
        return;
    }

    // Parse JSON
    let json: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            let _ = write_response(&mut stream, 400, r#"{"error":"invalid json"}"#);
            return;
        }
    };

    let hook_event_name = json
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if hook_event_name.is_empty() {
        let _ = write_response(&mut stream, 400, r#"{"error":"missing hook_event_name"}"#);
        return;
    }

    let event = HookEvent {
        session_id,
        hook_event_name,
        tool_name: json.get("tool_name").and_then(|v| v.as_str()).map(String::from),
        tool_input: json.get("tool_input").cloned(),
        claude_session_id: json.get("session_id").and_then(|v| v.as_str()).map(String::from),
    };

    let _ = app.emit("hook-event", event);
    let _ = write_response(&mut stream, 200, r#"{"ok":true}"#);
}

fn write_response(stream: &mut std::net::TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}
