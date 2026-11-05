// TURBZHACK's native shell.
//
// The whole game is the web app in the folder above; this only opens a window
// and points it at index.html. Keeping the shell this thin is deliberate —
// nothing about the game depends on Rust, so `npm run serve` in a browser and
// the .exe are running exactly the same code.
//
// Overlord mode can ask the shell to start Ollama on demand.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use std::thread;

#[tauri::command]
fn overlord_start() -> Result<String, String> {
    // Check if ollama exists
    let check = Command::new("ollama").arg("--version").output();
    if check.is_err() || !check.unwrap().status.success() {
        return Err("Ollama is not installed. Download it from https://ollama.com/download and restart.".into());
    }

    // Start the server in the background if it isn't already up
    thread::spawn(|| {
        let _ = Command::new("ollama").arg("serve").spawn();
    });

    // Give it a moment, then ensure the model
    thread::sleep(std::time::Duration::from_millis(1800));

    let pull = Command::new("ollama")
        .arg("pull")
        .arg("qwen2.5-coder:7b")
        .output();

    match pull {
        Ok(out) if out.status.success() => Ok("Overlord ready (qwen2.5-coder:7b)".into()),
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr);
            Err(format!("Model pull failed: {}", err))
        }
        Err(e) => Err(format!("Failed to pull model: {}", e)),
    }
}

#[tauri::command]
fn overlord_status() -> String {
    let check = Command::new("ollama").arg("--version").output();
    match check {
        Ok(out) if out.status.success() => "installed".into(),
        _ => "missing".into(),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![overlord_start, overlord_status])
        .run(tauri::generate_context!())
        .expect("failed to start TURBZHACK");
}
