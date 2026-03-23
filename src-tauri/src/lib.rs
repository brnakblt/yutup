use tauri::{AppHandle, Emitter};
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use std::thread;

#[derive(serde::Serialize, Clone)]
struct ProgressPayload {
    msg: String,
    percentage: Option<f64>,
    status: Option<String>,
}

#[tauri::command]
fn download_video(
    app_handle: AppHandle, 
    url: String, 
    format_type: String, 
    format_id: String,
    container_ext: String, 
    output_path: Option<String>, 
    browser: String, 
    sponsorblock: bool, 
    metadata: bool, 
    playlist_items: String,
    concurrent_fragments: String,
    cookies_file: Option<String>
) -> Result<(), String> {
    thread::spawn(move || {
        let mut args = vec![url.clone()];

        args.push("--ignore-errors".to_string());
        args.push("--ignore-no-formats-error".to_string());

        if playlist_items.is_empty() {
            args.push("--no-playlist".to_string());
        } else {
            args.push("--yes-playlist".to_string());
            args.push("--playlist-items".to_string());
            args.push(playlist_items);
        }

        if !concurrent_fragments.is_empty() && concurrent_fragments != "1" {
            args.push("-N".to_string());
            args.push(concurrent_fragments);
        }

        if sponsorblock {
            args.push("--sponsorblock-remove".to_string());
            args.push("sponsor,intro,outro".to_string());
        }

        if metadata {
            args.push("--write-auto-subs".to_string());
            args.push("--embed-subs".to_string());
            
            let supported_thumb_exts = ["mp3", "mkv", "mka", "ogg", "opus", "flac", "m4a", "mp4", "m4v", "mov"];
            if supported_thumb_exts.contains(&container_ext.as_str()) {
                args.push("--embed-thumbnail".to_string());
            }
        }

        if let Some(cookie_path) = cookies_file {
            args.push("--cookies".to_string());
            args.push(cookie_path);
        } else if !browser.is_empty() {
            let browser_target = if browser == "all" { "chrome" } else { &browser };
            args.push("--cookies-from-browser".to_string());
            args.push(browser_target.to_string());
        }

        if format_type == "audio" {
            args.push("-f".to_string());
            args.push(format_id);
            args.push("-x".to_string());
            args.push("--audio-format".to_string());
            args.push(container_ext);
        } else {
            args.push("-f".to_string());
            args.push(format_id);
            args.push("--merge-output-format".to_string());
            args.push(container_ext);
        }

        if let Some(path) = output_path {
            args.push("-o".to_string());
            args.push(path);
        }

        // Force yt-dlp to emit progress on fresh lines so the UI stream doesn't stutter on \r bounds
        args.push("--newline".to_string());

        // Force yt-dlp to print the video title and absolute file path to stdout upon success
        args.push("--print".to_string());
        args.push("after_move:%(title)s|||%(filepath)s".to_string());

        let _ = app_handle.emit("download-progress", ProgressPayload {
            msg: "Starting download...".to_string(),
            percentage: Some(0.0),
            status: Some("downloading".to_string()),
        });

        // Try to find the directory containing yt_dlp to set our working directory and Python path safely
        let mut target_dir = std::env::current_dir().unwrap_or_default();
        while !target_dir.join("yt_dlp").exists() && target_dir.parent().is_some() {
            target_dir = target_dir.parent().unwrap().to_path_buf();
        }

        // Use python module yt_dlp if yt-dlp binary is missing, but try python first since we are in the yt-dlp source directory
        let mut cmd = Command::new("python");
        cmd.current_dir(&target_dir);
        cmd.arg("-m");
        cmd.arg("yt_dlp");
        
        for arg in &args {
            cmd.arg(arg);
        }

        let mut child = match cmd
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn() {
                Ok(child) => child,
                Err(e) => {
                    let _ = app_handle.emit("download-progress", ProgressPayload {
                        msg: format!("Failed to start python -m yt_dlp: {}", e),
                        percentage: None,
                        status: Some("error".to_string()),
                    });
                    // Fallback to testing 'yt-dlp' executable directly
                    let mut fallback_cmd = Command::new("yt-dlp");
                    fallback_cmd.current_dir(&target_dir);
                    for arg in &args {
                        fallback_cmd.arg(arg);
                    }
                    let fallback_child = match fallback_cmd
                        .stdout(Stdio::piped())
                        .stderr(Stdio::piped())
                        .spawn() {
                            Ok(c) => c,
                            Err(e2) => {
                                let _ = app_handle.emit("download-progress", ProgressPayload {
                                    msg: format!("Failed to start yt-dlp binary: {}", e2),
                                    percentage: None,
                                    status: Some("error".to_string()),
                                });
                                return;
                            }
                        };
                    fallback_child
                }
            };
            
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();

        let app_handle_err = app_handle.clone();
        
        // We'll capture the last stderr line using an Arc<Mutex> so we can display it if it fails
        let last_error = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let last_error_clone = last_error.clone();

        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if let Ok(mut le) = last_error_clone.lock() {
                        *le = line.clone();
                    }
                    let _ = app_handle_err.emit("download-progress", ProgressPayload {
                        msg: format!("Log: {}", line),
                        percentage: None,
                        status: Some("downloading".to_string()),
                    });
                }
            }
        });

        let mut final_path = String::new();
        let mut final_title = String::new();
        let reader = BufReader::new(stdout);

        for line in reader.lines() {
            if let Ok(line) = line {
                let mut percentage: Option<f64> = None;
                    if line.contains("[download]") && line.contains("%") {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        for part in parts {
                            if part.ends_with("%") {
                                let val_str = part.trim_end_matches('%');
                                // Remove ANSI escape codes that yt-dlp might output
                                let clean_val_str = val_str.replace("\x1B[K", "").replace("\x1b[0;94m", "").replace("\x1b[0m", "");
                                if let Ok(val) = clean_val_str.parse::<f64>() {
                                    percentage = Some(val);
                                    break;
                                }
                            }
                        }
                    }

                    let clean_line = line.replace('\r', "").replace("\x1B[K", "").replace("\x1b[0;94m", "").replace("\x1b[0m", "");

                    // Strict matching for path and title extraction
                    if !clean_line.starts_with("[") && clean_line.contains("|||") {
                        let parts: Vec<&str> = clean_line.split("|||").collect();
                        if parts.len() == 2 {
                            final_title = parts[0].trim().to_string();
                            final_path = parts[1].trim().to_string();
                        }
                    } else if clean_line.contains("[download] Destination: ") {
                        final_path = clean_line.replace("[download] Destination: ", "").trim().to_string();
                    } else if clean_line.contains("[Merger] Merging formats into \"") {
                        let path = clean_line.replace("[Merger] Merging formats into \"", "");
                        final_path = path.trim_end_matches('"').to_string();
                    } else if clean_line.contains("[ExtractAudio] Destination: ") {
                        final_path = clean_line.replace("[ExtractAudio] Destination: ", "").trim().to_string();
                    } else if clean_line.contains("has already been downloaded") && clean_line.contains("[download] ") {
                        let path = clean_line.replace("[download] ", "").replace(" has already been downloaded", "").replace(" and merged", "");
                        final_path = path.trim().to_string();
                    }
                    
                    let _ = app_handle.emit("download-progress", ProgressPayload {
                    msg: line.clone(),
                    percentage,
                    status: Some("downloading".to_string()),
                });
            }
        }

        let status = child.wait().unwrap();
        if status.success() && !final_path.is_empty() {
            if final_title.is_empty() {
                if let Some(stem) = std::path::Path::new(&final_path).file_stem() {
                    final_title = stem.to_string_lossy().to_string();
                }
            }
            
            let _ = app_handle.emit("download-progress", ProgressPayload {
                msg: format!("Download complete!|||{}|||{}", final_path, final_title),
                percentage: Some(100.0),
                status: Some("success".to_string()),
            });
        } else {
            let err_msg = {
                let le = last_error.lock().unwrap();
                if le.is_empty() {
                    if status.success() {
                        "Download failed silently (No file was generated or captured). Please check your URL or verify if YouTube is blocking the request.".to_string()
                    } else {
                        format!("Download failed with status: {:?}", status.code())
                    }
                } else {
                    let mut msg = format!("Failed: {}", le);
                    if msg.contains("Could not copy Chrome cookie database") {
                        msg.push_str("\n💡 Tip: Please fully close Chrome so yt-dlp can read the cookies, then try again.");
                    } else if msg.contains("n challenge solving failed") || msg.contains("JavaScript runtime") {
                        msg.push_str("\n💡 Tip: YouTube is using a JavaScript challenge. Please install Node.js on your system or use the 'Cookies' option to bypass this.");
                    } else if msg.contains("Failed to decrypt with DPAPI") {
                        msg.push_str("\n💡 Tip: Chrome's new security on Windows is blocking cookie extraction. Please use Firefox or export your cookies to a .txt file using a browser extension.");
                    }
                    msg
                }
            };
            let mut final_err = err_msg;
            if final_err.contains("Download failed silently") {
                 let le = last_error.lock().unwrap();
                 if le.contains("n challenge solving failed") || le.contains("JavaScript runtime") {
                     final_err = format!("{}\n💡 Tip: YouTube is blocking this request with a JS challenge. Please install Node.js or use 'Cookies' to bypass this.", final_err);
                 }
            }

            let _ = app_handle.emit("download-progress", ProgressPayload {
                msg: final_err,
                percentage: None,
                status: Some("error".to_string()),
            });
        }
    });

    Ok(())
}

#[tauri::command]
async fn fetch_formats(url: String, browser: String, cookies_file: Option<String>) -> Result<String, String> {
    let mut args = vec![
        "-J".to_string(), 
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
        url
    ];

    if let Some(cookie_path) = cookies_file {
        args.push("--cookies".to_string());
        args.push(cookie_path);
    } else if !browser.is_empty() {
        let browser_target = if browser == "all" { "chrome" } else { &browser };
        args.push("--cookies-from-browser".to_string());
        args.push(browser_target.to_string());
    }

    let mut target_dir = std::env::current_dir().unwrap_or_default();
    while !target_dir.join("yt_dlp").exists() && target_dir.parent().is_some() {
        target_dir = target_dir.parent().unwrap().to_path_buf();
    }

    let mut cmd = Command::new("python");
    cmd.current_dir(&target_dir);
    cmd.arg("-m");
    cmd.arg("yt_dlp");
    
    for arg in &args {
        cmd.arg(arg);
    }

    let output = cmd.output().unwrap_or_else(|_| {
        let mut fallback = Command::new("yt-dlp");
        fallback.current_dir(&target_dir);
        for arg in &args {
            fallback.arg(arg);
        }
        fallback.output().expect("Failed to execute yt-dlp")
    });

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![download_video, fetch_formats])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
