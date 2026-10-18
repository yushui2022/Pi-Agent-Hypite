#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod runtime;
use runtime::Runtime;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{Emitter, Manager};

#[derive(Default)]
struct DesktopLifecycle {
    ready: AtomicBool,
}

#[tauri::command]
fn desktop_ready(state: tauri::State<'_, DesktopLifecycle>) {
    state.ready.store(true, Ordering::Release);
}

#[tauri::command]
fn desktop_close(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
async fn runtime_request(
    runtime: tauri::State<'_, Arc<Runtime>>,
    route: String,
    method: String,
    body: Value,
) -> Result<Value, String> {
    let runtime = runtime.inner().clone();
    tauri::async_runtime::spawn_blocking(move || runtime.request(route, method, body))
        .await
        .map_err(|e| e.to_string())?
}

fn main() {
    let runtime = match Runtime::start() {
        Ok(value) => Arc::new(value),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    };
    if std::env::args().any(|arg| arg == "--smoke-test") {
        let result = smoke(&runtime);
        runtime.shutdown();
        if let Err(error) = result {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    let app = tauri::Builder::default()
        .manage(runtime.clone())
        .manage(DesktopLifecycle::default())
        .invoke_handler(tauri::generate_handler![
            runtime_request,
            desktop_ready,
            desktop_close
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window
                    .state::<DesktopLifecycle>()
                    .ready
                    .load(Ordering::Acquire)
                {
                    api.prevent_close();
                    let _ = window.emit("desktop-close-requested", ());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Unable to build desktop window");
    app.run(move |app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app.state::<Arc<Runtime>>().shutdown();
        }
    });
}

fn smoke(runtime: &Runtime) -> Result<(), String> {
    let services = runtime.request("/api/services".into(), "GET".into(), json!({}))?;
    if services["status"] != 200 {
        return Err(services.to_string());
    }
    let created = runtime.request("/api/jobs".into(), "POST".into(), json!({"title":"桌面宿主连接验收", "account":"内部", "product":"技术样例", "language":"中文", "requirements":"验证 Rust 到真实 Node 业务链路", "technicalSample":true,"references":[]}))?;
    if created["status"] != 201 {
        return Err(created.to_string());
    }
    let id = created["data"]["id"].as_str().ok_or("No job id")?;
    let loaded = runtime.request(format!("/api/jobs/{id}"), "GET".into(), json!({}))?;
    if loaded["status"] != 200 {
        return Err(loaded.to_string());
    }
    let directory = created["data"]["directory"]
        .as_str()
        .ok_or("Missing job directory")?;
    let root = std::env::var("PI_WORKSPACE_ROOT").map_err(|e| e.to_string())?;
    for file in ["main.svml", "build.svrun", "template.svs"] {
        std::fs::copy(
            std::path::Path::new(&root)
                .join("examples/technical-sample")
                .join(file),
            std::path::Path::new(directory).join("project").join(file),
        )
        .map_err(|e| e.to_string())?;
    }
    let checked = runtime.request(
        format!("/api/jobs/{id}/inspect"),
        "POST".into(),
        json!({"operation":"check","source":"main.svml"}),
    )?;
    if checked["status"] != 200 || checked["data"]["ok"] != true {
        return Err(checked.to_string());
    }
    let request_id = id.trim_start_matches("job_");
    let started = runtime.request(
        format!("/api/jobs/{id}/agent-runs"),
        "POST".into(),
        json!({"requestId":request_id}),
    )?;
    if started["status"] != 202 {
        return Err(started.to_string());
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    let session = loop {
        let runs = runtime.request(
            format!("/api/jobs/{id}/agent-runs"),
            "GET".into(),
            json!({}),
        )?;
        let record = &runs["data"][0];
        if record["status"] == "completed" {
            break record["sessionId"].clone();
        }
        if std::time::Instant::now() > deadline {
            return Err(format!("Pi probe incomplete: {runs}"));
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    };
    println!(
        "{}",
        json!({"desktopBridge":"passed","jobId":id,"hypitCheck":true,"piSessionId":session,"services":services["data"],"note":"Rust/stdio smoke only; native UI and standalone installer require separate acceptance"})
    );
    Ok(())
}
