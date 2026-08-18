#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};

type SidecarState = Arc<Mutex<Option<Child>>>;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, PartialEq)]
struct PortablePaths {
    root: PathBuf,
    node: PathBuf,
    server: PathBuf,
    database: PathBuf,
    config: PathBuf,
    logs: PathBuf,
}

impl PortablePaths {
    fn from_root(root: PathBuf) -> Self {
        Self {
            node: root.join("runtime").join("node.exe"),
            server: root.join("runtime").join("app").join("server.js"),
            database: root.join("data").join("g2b-contracts.sqlite"),
            config: root.join("config").join("app.env"),
            logs: root.join("logs"),
            root,
        }
    }

    fn from_current_exe() -> Result<Self, String> {
        let executable = std::env::current_exe()
            .map_err(|error| format!("failed to get current executable path: {error}"))?;
        let root = executable
            .parent()
            .ok_or_else(|| "failed to get parent directory of executable".to_string())?
            .to_path_buf();
        Ok(Self::from_root(root))
    }

    fn prepare(&self) -> Result<(), String> {
        for directory in [
            self.root.join("data"),
            self.root.join("config"),
            self.logs.clone(),
        ] {
            fs::create_dir_all(&directory).map_err(|error| {
                format!(
                    "failed to create directory {}: {error}",
                    directory.display()
                )
            })?;
        }
        Ok(())
    }
}

fn parse_app_env_contents(contents: &str) -> Result<BTreeMap<String, String>, String> {
    const ALLOWED: [&str; 5] = [
        "DATA_GO_KR_SERVICE_KEY",
        "G2B_SERVICE_KEY",
        "PUBLIC_DATA_SERVICE_KEY",
        "NARA_BID_API_KEY",
        "ENRICHMENT_ENABLED",
    ];
    let mut values = BTreeMap::new();
    for (index, raw_line) in contents.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, raw_value) = line.split_once('=').ok_or_else(|| {
            format!(
                "invalid env file line {}: expected key=value format",
                index + 1
            )
        })?;
        let key = key.trim();
        if !ALLOWED.contains(&key) {
            continue;
        }
        let value = raw_value.trim().trim_matches('"').trim_matches('\'');
        values.insert(key.to_string(), value.to_string());
    }
    Ok(values)
}

fn read_app_env(path: &Path) -> Result<BTreeMap<String, String>, String> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("failed to read env file {}: {error}", path.display()))?;
    parse_app_env_contents(&contents)
}

fn available_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("failed to bind loopback port: {error}"))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| format!("failed to read local port: {error}"))
}

fn spawn_server(paths: &PortablePaths, port: u16) -> Result<Child, String> {
    if !paths.node.is_file() {
        return Err(format!(
            "node executable not found at {}",
            paths.node.display()
        ));
    }
    if !paths.server.is_file() {
        return Err(format!(
            "server file not found at {}",
            paths.server.display()
        ));
    }
    paths.prepare()?;
    let stdout = File::create(paths.logs.join("server.out.log"))
        .map_err(|error| format!("failed to create stdout log: {error}"))?;
    let stderr = File::create(paths.logs.join("server.err.log"))
        .map_err(|error| format!("failed to create stderr log: {error}"))?;
    let server_directory = paths
        .server
        .parent()
        .ok_or_else(|| "server parent directory missing".to_string())?;

    let mut command = Command::new(&paths.node);
    command
        .arg(&paths.server)
        .current_dir(server_directory)
        .env("NODE_ENV", "production")
        .env("HOSTNAME", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("DATABASE_URL", &paths.database)
        .envs(read_app_env(&paths.config)?)
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command
        .spawn()
        .map_err(|error| format!("failed to spawn local server: {error}"))
}

fn server_responds(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}")
            .parse()
            .expect("valid loopback address"),
        Duration::from_millis(300),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let request =
        format!("GET /competitors HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = [0_u8; 64];
    let Ok(length) = stream.read(&mut response) else {
        return false;
    };
    let status = String::from_utf8_lossy(&response[..length]);
    status.starts_with("HTTP/1.1 200") || status.starts_with("HTTP/1.1 30")
}

fn wait_for_server(state: &SidecarState, port: u16) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        {
            let mut guard = state
                .lock()
                .map_err(|_| "failed to lock server state".to_string())?;
            if let Some(child) = guard.as_mut() {
                if child
                    .try_wait()
                    .map_err(|error| format!("failed to inspect child state: {error}"))?
                    .is_some()
                {
                    return Err(
                        "child exited during startup; see logs/server.err.log for details"
                            .to_string(),
                    );
                }
            }
        }
        if server_responds(port) {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err("server failed to start within 60 seconds".to_string());
        }
        thread::sleep(Duration::from_millis(200));
    }
}

fn stop_child(state: &SidecarState) {
    if let Ok(mut guard) = state.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let state: SidecarState = Arc::new(Mutex::new(None));
            app.manage(state.clone());
            let window = app
                .get_webview_window("main")
                .ok_or("Cannot find the main window.")?;

            thread::spawn(move || {
                let result = (|| -> Result<(), String> {
                    let paths = PortablePaths::from_current_exe()?;
                    let port = available_port()?;
                    let child = spawn_server(&paths, port)?;
                    *state
                        .lock()
                        .map_err(|_| "failed to store server state".to_string())? = Some(child);
                    wait_for_server(&state, port)?;
                    let url = tauri::Url::parse(&format!("http://127.0.0.1:{port}/competitors"))
                        .map_err(|error| format!("invalid local URL: {error}"))?;
                    window
                        .navigate(url)
                        .map_err(|error| format!("Cannot open competitor view: {error}"))
                })();
                if result.is_err() {
                    stop_child(&state);
                    let _ = window.eval(
                        "document.querySelector('p').textContent = '\\uD504\\uB85C\\uADF8\\uB7A8\\uC744 \\uC2DC\\uC791\\uD560 \\uC218 \\uC5C6\\uC2B5\\uB2C8\\uB2E4. logs \\uD3F4\\uB354\\uB97C \\uD655\\uC778\\uD558\\uC138\\uC694.';",
                    );
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Cannot start the Tauri application.");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if let Some(state) = app_handle.try_state::<SidecarState>() {
                stop_child(&state);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{parse_app_env_contents, PortablePaths};
    use std::path::PathBuf;

    #[test]
    fn portable_paths_are_relative_to_executable_root() {
        let paths = PortablePaths::from_root(PathBuf::from(r"C:\portable"));
        assert_eq!(paths.node, PathBuf::from(r"C:\portable\runtime\node.exe"));
        assert_eq!(
            paths.server,
            PathBuf::from(r"C:\portable\runtime\app\server.js")
        );
        assert_eq!(
            paths.database,
            PathBuf::from(r"C:\portable\data\g2b-contracts.sqlite")
        );
        assert_eq!(paths.config, PathBuf::from(r"C:\portable\config\app.env"));
    }

    #[test]
    fn env_parser_accepts_only_supported_keys() {
        let values = parse_app_env_contents(
            "# comment\nDATA_GO_KR_SERVICE_KEY=test-key\nUNKNOWN=ignored\nENRICHMENT_ENABLED=true\n",
        )
        .expect("valid env");
        assert_eq!(
            values.get("DATA_GO_KR_SERVICE_KEY").map(String::as_str),
            Some("test-key")
        );
        assert_eq!(
            values.get("ENRICHMENT_ENABLED").map(String::as_str),
            Some("true")
        );
        assert!(!values.contains_key("UNKNOWN"));
    }
}
