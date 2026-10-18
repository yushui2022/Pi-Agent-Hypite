use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Receiver},
        Mutex,
    },
    time::{Duration, Instant},
};

#[cfg(windows)]
mod ownership {
    use std::{
        io,
        mem::size_of,
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::Child,
    };
    use windows_sys::Win32::System::JobObjects::*;
    pub struct Job(OwnedHandle);
    impl Job {
        pub fn assign(child: &Child) -> io::Result<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return Err(io::Error::last_os_error());
                }
                let job = Self(OwnedHandle::from_raw_handle(handle));
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                if SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const _,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                ) == 0
                    || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
                {
                    return Err(io::Error::last_os_error());
                }
                Ok(job)
            }
        }
        pub fn terminate(&self) {
            unsafe {
                TerminateJobObject(self.0.as_raw_handle(), 1);
            }
        }
    }
}

pub struct Runtime {
    connection: Mutex<(ChildStdin, Receiver<Value>)>,
    child: Mutex<Child>,
    next_id: AtomicU64,
    stopped: AtomicBool,
    #[cfg(windows)]
    job: ownership::Job,
}

impl Runtime {
    // P1a deliberately requires the development launcher. Resource discovery for
    // a standalone installer belongs to P1b, never silently falls back to PATH.
    pub fn start() -> Result<Self, String> {
        if !cfg!(debug_assertions) {
            return Err("Standalone runtime packaging is not implemented yet (P1b)".into());
        }
        let root = std::env::var("PI_WORKSPACE_ROOT").map_err(|_| "Use npm run desktop:dev")?;
        let node = std::env::var("PI_WORKSPACE_NODE").map_err(|_| "Node runtime path missing")?;
        let config =
            std::env::var("PI_WORKSPACE_CONFIG").map_err(|_| "Isolated desktop config missing")?;
        let mut cmd = Command::new(node);
        cmd.current_dir(&root)
            .arg(std::path::Path::new(&root).join("apps/runtime/stdio.mjs"))
            .arg(config)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| e.to_string())?;
        #[cfg(windows)]
        let job = match ownership::Job::assign(&child) {
            Ok(job) => job,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Cannot own runtime process tree: {e}"));
            }
        };
        let stdin = child.stdin.take().ok_or("Missing runtime stdin")?;
        let stdout = child.stdout.take().ok_or("Missing runtime stdout")?;
        let (tx, rx) = mpsc::sync_channel(64);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                // Bounded line reads also protect against a broken runtime emitting no newline.
                let mut bytes = Vec::new();
                match std::io::Read::take(&mut reader, 8 * 1024 * 1024 + 1)
                    .read_until(b'\n', &mut bytes)
                {
                    Ok(0) | Err(_) => break,
                    _ => {}
                }
                if bytes.len() > 8 * 1024 * 1024 {
                    break;
                }
                let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                    break;
                };
                if value["protocol"] != 1 || tx.send(value).is_err() {
                    break;
                }
            }
        });
        let runtime = Self {
            connection: Mutex::new((stdin, rx)),
            child: Mutex::new(child),
            next_id: AtomicU64::new(1),
            stopped: AtomicBool::new(false),
            #[cfg(windows)]
            job,
        };
        let ready = runtime
            .connection
            .lock()
            .map_err(|e| e.to_string())?
            .1
            .recv_timeout(Duration::from_secs(15))
            .map_err(|e| format!("Runtime did not start: {e}"))?;
        if ready["event"] != "ready" {
            return Err("Invalid runtime handshake".into());
        }
        Ok(runtime)
    }

    fn exchange(
        &self,
        connection: &mut (ChildStdin, Receiver<Value>),
        mut input: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        input["id"] = json!(id);
        input["protocol"] = json!(1);
        let mut bytes = serde_json::to_vec(&input).map_err(|e| e.to_string())?;
        if bytes.len() > 65536 {
            return Err("Request too large".into());
        }
        bytes.push(b'\n');
        connection
            .0
            .write_all(&bytes)
            .and_then(|_| connection.0.flush())
            .map_err(|e| format!("Runtime disconnected: {e}"))?;
        let deadline = Instant::now() + timeout;
        loop {
            let value = connection
                .1
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .map_err(|e| {
                    format!("Runtime response unavailable (do not blindly retry writes): {e}")
                })?;
            if value["id"] == id {
                return Ok(value);
            }
        }
    }

    pub fn request(&self, route: String, method: String, body: Value) -> Result<Value, String> {
        if self.stopped.load(Ordering::Acquire) {
            return Err("Runtime stopping".into());
        }
        let mut connection = self.connection.lock().map_err(|e| e.to_string())?;
        if self.stopped.load(Ordering::Acquire) {
            return Err("Runtime stopping".into());
        }
        self.exchange(
            &mut connection,
            json!({"route":route,"method":method,"body":body}),
            Duration::from_secs(60),
        )
    }

    pub fn shutdown(&self) {
        if self.stopped.swap(true, Ordering::AcqRel) {
            return;
        }
        if let Ok(mut connection) = self.connection.try_lock() {
            let _ = self.exchange(
                &mut connection,
                json!({"command":"shutdown"}),
                Duration::from_secs(3),
            );
        }
        // Always reap descendants, including ones a faulty worker failed to stop.
        #[cfg(windows)]
        self.job.terminate();
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::os::windows::{
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::CommandExt,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, SYNCHRONIZATION_SYNCHRONIZE,
    };

    #[test]
    fn job_close_reaps_runtime_and_descendant() {
        let node = std::env::var("PI_WORKSPACE_NODE").expect("Use npm run desktop:test");
        let mut child = Command::new(node).args(["-e", "process.stdin.once('data',()=>{const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(c.pid);setInterval(()=>{},1000);});"])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).creation_flags(0x08000000).spawn().unwrap();
        let job = ownership::Job::assign(&child).unwrap();
        child.stdin.as_mut().unwrap().write_all(b"go\n").unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let pid: u32 = line.trim().parse().unwrap();
        let handle = unsafe { OpenProcess(SYNCHRONIZATION_SYNCHRONIZE, 0, pid) };
        assert!(!handle.is_null());
        let descendant = unsafe { OwnedHandle::from_raw_handle(handle) };
        drop(job); // Equivalent to the host losing its last handle on crash.
        assert_eq!(
            unsafe { WaitForSingleObject(descendant.as_raw_handle(), 5000) },
            0
        );
        child.wait().unwrap();
    }
}
