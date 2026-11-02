// TURBZHACK's native shell.
//
// The whole game is the web app in the folder above; this only opens a window
// and points it at index.html. Keeping the shell this thin is deliberate —
// nothing about the game depends on Rust, so `npm run serve` in a browser and
// the .exe are running exactly the same code.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to start TURBZHACK");
}
