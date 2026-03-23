import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { downloadDir } from "@tauri-apps/api/path";

let urlInput: HTMLInputElement | null;
let playlistItemsInput: HTMLInputElement | null;
let downloadForm: HTMLFormElement | null;
let downloadBtn: HTMLButtonElement | null;
let fetchFormatsBtn: HTMLButtonElement | null;
let progressContainer: HTMLDivElement | null;
let statusMsg: HTMLSpanElement | null;
let statusPerc: HTMLSpanElement | null;
let progressBarFill: HTMLDivElement | null;
let selectDownloadDirBtn: HTMLButtonElement | null;
let downloadDirDisplay: HTMLDivElement | null;
let sponsorBlockToggle: HTMLInputElement | null;
let metadataToggle: HTMLInputElement | null;
let concurrentSlider: HTMLInputElement | null = null;
let concurrentValLabel: HTMLSpanElement | null = null;
let browserSelect: HTMLSelectElement | null;
let selectCookiesBtn: HTMLButtonElement | null = null;

let previewContainer: HTMLElement | null = null;
let previewThumbnail: HTMLElement | null = null;
let previewTitle: HTMLElement | null = null;
let previewDuration: HTMLElement | null = null;
let previewUploader: HTMLElement | null = null;

let selectedCookiesFile: string | null = null;
let customDownloadDir: string | null = null;

interface ProgressPayload {
  msg: string;
  percentage?: number;
  status?: 'downloading' | 'success' | 'error';
}

interface YTDlpFormat {
  format_id: string;
  ext: string;
  vcodec: string;
  acodec: string;
  filesize?: number;
  filesize_approx?: number;
  format_note?: string;
  resolution?: string;
  fps?: number;
}

interface DownloadHistoryItem {
  url: string;
  date: string;
  format: string;
  type: string;
  filepath?: string;
  title?: string;
}

function formatDuration(seconds: number): string {
  if (!seconds) return "00:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

let downloadHistory: DownloadHistoryItem[] = [];

function renderHistory() {
  const container = document.getElementById("history-container");
  const list = document.getElementById("history-list");
  if (!container || !list) return;

  if (downloadHistory.length === 0) {
    container.classList.add("hidden");
    return;
  }

  container.classList.remove("hidden");
  list.innerHTML = "";

  const typeFilter = (document.getElementById("history-type-filter") as HTMLSelectElement)?.value || "all";
  const dateFilter = (document.getElementById("history-date-filter") as HTMLSelectElement)?.value || "all";

  let filteredHistory = [...downloadHistory];

  // Apply Type Filter
  if (typeFilter !== "all") {
    filteredHistory = filteredHistory.filter(item => (item.type || 'video') === typeFilter);
  }

  // Apply Date Filter
  if (dateFilter !== "all") {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    filteredHistory = filteredHistory.filter(item => {
      const itemTime = new Date(item.date).getTime();
      if (dateFilter === "today") {
        return itemTime >= startOfToday;
      } else if (dateFilter === "week") {
        return itemTime >= (startOfToday - 7 * 24 * 60 * 60 * 1000);
      } else if (dateFilter === "older") {
        return itemTime < (startOfToday - 7 * 24 * 60 * 60 * 1000);
      }
      return true;
    });
  }

  if (filteredHistory.length === 0) {
    list.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 2rem 0; font-size: 0.9rem;">No matching downloads</div>`;
    return;
  }

  const reversed = filteredHistory.reverse();
  reversed.forEach(item => {
    const div = document.createElement("div");
    div.className = "history-item";
    
    const itemType = item.type || 'video';
    const displayTitle = item.title || "Legacy Download (Title Unavailable)";
    
    let html = `
      <div class="history-title" style="font-weight: 600; font-size: 0.95rem; margin-bottom: 0.4rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${displayTitle}">${displayTitle}</div>
      <div class="history-meta" style="flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.5rem; display: flex;">
        <div style="display: flex; gap: 0.8rem; align-items: center; width: 100%; font-size: 0.8rem;">
          <span style="font-weight: 600;">${itemType === 'video' ? '🎬' : '🎵'} ${item.format.toUpperCase()}</span>
          <a href="${item.url}" target="_blank" style="color: var(--text-secondary); text-decoration: none; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.url}">${item.url}</a>
          <span style="margin-left: auto; color: var(--text-secondary); font-size: 0.75rem;">${new Date(item.date).toLocaleDateString()} ${new Date(item.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
        </div>
    `;

    if (item.filepath) {
      html += `<button class="open-file-btn" data-path="${item.filepath.replace(/"/g, '&quot;')}" style="margin-top: 0.5rem; padding: 0.3rem 0.8rem; border-radius: 8px; border: 1px solid var(--card-border); background: rgba(0, 0, 0, 0.4); color: var(--text-primary); cursor: pointer; font-size: 0.8rem; font-weight: 600; font-family: inherit; transition: all 0.2s ease;">📂 Open File</button>`;
    }
    
    html += `</div>`;
    div.innerHTML = html;
    list.appendChild(div);
  });

  const openBtns = list.querySelectorAll('.open-file-btn');
  openBtns.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const path = (e.currentTarget as HTMLButtonElement).getAttribute('data-path');
      if (path) {
        try {
          await openPath(path);
        } catch (error) {
          console.error('Failed to open file:', error);
          alert('Failed to open file. The file might have been moved or deleted.');
        }
      }
    });
  });
}

function addToHistory(url: string, format: string, type: string, filepath?: string, title?: string) {
  downloadHistory.push({
    url,
    date: new Date().toISOString(),
    format,
    type,
    filepath,
    title
  });
  if (downloadHistory.length > 50) {
    downloadHistory.shift();
  }
  localStorage.setItem('ytHistory', JSON.stringify(downloadHistory));
  renderHistory();
}

let unlistenProgress: (() => void) | null = null;

function formatBytes(bytes?: number): string {
  if (!bytes) return "Unknown size";
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Byte';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)).toString());
  return Math.round(bytes / Math.pow(1024, i)) + ' ' + sizes[i];
}

async function startDownload(e: Event) {
  e.preventDefault();
  
  if (!urlInput || !downloadBtn || !progressContainer || !statusMsg || !statusPerc || !progressBarFill) return;

  const url = urlInput.value;
  if (!url) return;

  const playlistItems = playlistItemsInput ? playlistItemsInput.value.trim() : "";

  const formatType = (document.querySelector('input[name="format"]:checked') as HTMLInputElement).value;
  const selectedFormatSelect = formatType === 'video' 
    ? document.querySelector("#video-format") as HTMLSelectElement 
    : document.querySelector("#audio-format") as HTMLSelectElement;
  const selectedFormatString = selectedFormatSelect.value;

  let formatId = "bestvideo+bestaudio/best";
  let containerExt = "mp4";

  if (selectedFormatString.includes('|')) {
    const parts = selectedFormatString.split('|');
    formatId = parts[0];
    containerExt = parts[1];
  }

  let output_path = null;

  if (customDownloadDir) {
    output_path = `${customDownloadDir}/%(title)s.%(ext)s`;
  } else {
    try {
      // Resolve the system's default Downloads folder natively
      const defaultDir = await downloadDir();
      output_path = `${defaultDir}/%(title)s.%(ext)s`;
    } catch {
      // If it fails for any reason, let yt-dlp fall back to its own local execution directory (null)
      output_path = null;
    }
  }

  let sponsorBlock = true;
  if (sponsorBlockToggle) {
    sponsorBlock = sponsorBlockToggle.checked;
    localStorage.setItem('sponsorBlock', sponsorBlock.toString());
  }

  let metadataEmbed = true;
  if (metadataToggle) {
    metadataEmbed = metadataToggle.checked;
    localStorage.setItem('metadataEmbed', metadataEmbed.toString());
  }

  let concurrentFragments = "3";
  if (concurrentSlider) {
    concurrentFragments = concurrentSlider.value;
    localStorage.setItem('concurrentFragments', concurrentFragments);
  }

  let browser = "";
  if (browserSelect) {
    browser = browserSelect.value;
    localStorage.setItem('browserCookie', browser);
  }

  // Reset UI
  downloadBtn.disabled = true;
  downloadBtn.textContent = 'Downloading...';
  progressContainer.classList.remove('hidden');
  progressContainer.classList.remove('status-success', 'status-error');
  progressBarFill.style.width = '0%';
  statusPerc.textContent = '0%';
  statusMsg.textContent = 'Initializing...';

  // Clean up previous event listener to avoid duplicates
  if (unlistenProgress) {
    unlistenProgress();
    unlistenProgress = null;
  }

  try {
    unlistenProgress = await listen<ProgressPayload>('download-progress', (event) => {
      const payload = event.payload;
      if (statusMsg) statusMsg.textContent = payload.msg;
      
      if (payload.percentage !== undefined && progressBarFill && statusPerc) {
        progressBarFill.style.width = `${payload.percentage}%`;
        statusPerc.textContent = `${payload.percentage.toFixed(1)}%`;
      }

      if (payload.status === 'success') {
        const parts = payload.msg.split('|||');
        const finalPath = parts.length > 1 ? parts[1].trim() : undefined;
        const finalTitle = parts.length > 2 ? parts[2].trim() : undefined;

        progressContainer?.classList.add('status-success');
        downloadBtn!.disabled = false;
        downloadBtn!.textContent = 'Download Another';
        if (statusMsg) statusMsg.textContent = 'Download Complete!';
        addToHistory(url, containerExt, formatType, finalPath, finalTitle);
      } else if (payload.status === 'error') {
        progressContainer?.classList.add('status-error');
        downloadBtn!.disabled = false;
        downloadBtn!.textContent = 'Retry Download';
      }
    });

    await invoke("download_video", { 
      url, 
      formatType, 
      formatId,
      containerExt, 
      outputPath: output_path, 
      browser, 
      sponsorblock: sponsorBlock, 
      metadata: metadataEmbed,
      playlistItems: playlistItems,
      concurrentFragments: concurrentFragments,
      cookiesFile: selectedCookiesFile
    });
  } catch (error) {
    if (statusMsg) statusMsg.textContent = `Error: ${error}`;
    progressContainer?.classList.add('status-error');
    console.error(error);
    downloadBtn!.disabled = false;
    downloadBtn!.textContent = 'Try Again';

    if (unlistenProgress) {
        unlistenProgress();
        unlistenProgress = null;
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  urlInput = document.querySelector("#url-input");
  playlistItemsInput = document.querySelector("#playlist-items-input");
  downloadForm = document.querySelector("#download-form");
  downloadBtn = document.querySelector("#download-btn");
  fetchFormatsBtn = document.querySelector("#fetch-formats-btn");
  progressContainer = document.querySelector("#progress-container");
  statusMsg = document.querySelector("#status-msg");
  statusPerc = document.querySelector("#status-perc");
  progressBarFill = document.querySelector("#progress-bar-fill");
  selectDownloadDirBtn = document.querySelector("#select-download-dir-btn");
  downloadDirDisplay = document.querySelector("#download-dir-display");
  previewContainer = document.querySelector("#preview-container");
  previewThumbnail = document.querySelector("#preview-thumbnail");
  previewTitle = document.querySelector("#preview-title");
  previewDuration = document.querySelector("#preview-duration");
  previewUploader = document.querySelector("#preview-uploader");

  const savedHistory = localStorage.getItem('ytHistory');
  if (savedHistory) {
    try {
      downloadHistory = JSON.parse(savedHistory);
      renderHistory();
    } catch {
      downloadHistory = [];
    }
  }

  const clearHistoryBtn = document.getElementById("clear-history-btn");
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", () => {
      downloadHistory = [];
      localStorage.removeItem('ytHistory');
      renderHistory();
    });
  }

  const typeFilterSelect = document.getElementById("history-type-filter");
  if (typeFilterSelect) {
    typeFilterSelect.addEventListener("change", renderHistory);
  }

  const dateFilterSelect = document.getElementById("history-date-filter");
  if (dateFilterSelect) {
    dateFilterSelect.addEventListener("change", renderHistory);
  }

  const savedDownloadDir = localStorage.getItem('customDownloadDir');
  if (savedDownloadDir !== null && savedDownloadDir !== "") {
    customDownloadDir = savedDownloadDir;
    if (downloadDirDisplay) downloadDirDisplay.textContent = customDownloadDir;
  }

  if (selectDownloadDirBtn) {
    selectDownloadDirBtn.addEventListener('click', async () => {
      const selectedDir = await open({
        directory: true,
        multiple: false,
        title: "Select Default Download Folder"
      });

      if (selectedDir) {
        customDownloadDir = selectedDir as string;
        if (downloadDirDisplay) downloadDirDisplay.textContent = customDownloadDir;
        localStorage.setItem('customDownloadDir', customDownloadDir);
      }
    });
  }

  sponsorBlockToggle = document.querySelector("#sponsorblock-toggle");
  if (sponsorBlockToggle) {
    const savedSponsor = localStorage.getItem('sponsorBlock');
    if (savedSponsor !== null) {
      sponsorBlockToggle.checked = savedSponsor === 'true';
    }
    
    sponsorBlockToggle.addEventListener('change', () => {
      localStorage.setItem('sponsorBlock', sponsorBlockToggle!.checked.toString());
    });
  }

  metadataToggle = document.querySelector("#metadata-toggle");
  if (metadataToggle) {
    const savedMetadata = localStorage.getItem('metadataEmbed');
    if (savedMetadata !== null) {
      metadataToggle.checked = savedMetadata === 'true';
    }
    
    metadataToggle.addEventListener('change', () => {
      localStorage.setItem('metadataEmbed', metadataToggle!.checked.toString());
    });
  }

  concurrentSlider = document.querySelector("#concurrent-downloads-slider");
  concurrentValLabel = document.querySelector("#concurrent-downloads-val");
  
  if (concurrentSlider && concurrentValLabel) {
    const savedConcurrent = localStorage.getItem('concurrentFragments');
    if (savedConcurrent !== null) {
      concurrentSlider.value = savedConcurrent;
      concurrentValLabel.textContent = `${savedConcurrent} Threads`;
    }

    concurrentSlider.addEventListener('input', () => {
      concurrentValLabel!.textContent = `${concurrentSlider!.value} Threads`;
    });

    concurrentSlider.addEventListener('change', () => {
      localStorage.setItem('concurrentFragments', concurrentSlider!.value);
    });
  }

  browserSelect = document.querySelector("#browser-select");
  if (browserSelect) {
    const savedBrowser = localStorage.getItem('browserCookie');
    if (savedBrowser !== null) {
      browserSelect.value = savedBrowser;
    } else {
      browserSelect.value = ""; // Default to No Cookies
      localStorage.setItem('browserCookie', "");
    }

    browserSelect.addEventListener('change', () => {
      localStorage.setItem('browserCookie', browserSelect!.value);
      if (browserSelect!.value !== "") {
        selectedCookiesFile = null;
        if (selectCookiesBtn) selectCookiesBtn.textContent = "📄 File";
      }
    });
  }

  selectCookiesBtn = document.querySelector("#select-cookies-btn");
  if (selectCookiesBtn) {
    selectCookiesBtn.addEventListener("click", async () => {
      const file = await open({
        multiple: false,
        filters: [{ name: "Text", extensions: ["txt"] }],
        title: "Select cookies.txt file"
      });
      if (file) {
        selectedCookiesFile = file as string;
        selectCookiesBtn!.textContent = "📄 Loaded";
        if (browserSelect) {
            browserSelect.value = "";
            localStorage.setItem('browserCookie', "");
        }
      }
    });
  }

  if (downloadForm) {
    downloadForm.addEventListener("submit", startDownload);
  }

  if (fetchFormatsBtn) {
    fetchFormatsBtn.addEventListener('click', async () => {
      const url = urlInput?.value;
      if (!url) return;

      fetchFormatsBtn!.textContent = "Fetching...";
      fetchFormatsBtn!.disabled = true;

      try {
        const browser = browserSelect?.value || "";
        const jsonStr = await invoke<string>("fetch_formats", { url, browser, cookiesFile: selectedCookiesFile });
        const metadata = JSON.parse(jsonStr);
        const formats: YTDlpFormat[] = metadata.formats || [];

        // Update Preview UI
        if (previewContainer && previewTitle && previewThumbnail && previewDuration && previewUploader) {
          previewContainer.classList.remove('hidden');
          previewTitle.textContent = metadata.title || "Unknown Title";
          previewThumbnail.style.backgroundImage = `url(${metadata.thumbnail})`;
          previewDuration.textContent = formatDuration(metadata.duration);
          previewUploader.textContent = metadata.uploader || metadata.channel || "Unknown Channel";
        }

        // Clear existing options
        videoFormatSelect.innerHTML = "";
        audioFormatSelect.innerHTML = "";

        const videoFormats = formats.filter(f => f.vcodec !== "none");
        const audioFormats = formats.filter(f => f.vcodec === "none" && f.acodec !== "none");

        // Helper to add best option first
        videoFormatSelect.innerHTML += `<option value="bestvideo+bestaudio/best|mp4">Best Available (Auto Merge)</option>`;
        audioFormatSelect.innerHTML += `<option value="bestaudio/best|mp3">Best Audio</option>`;

        // Populate Video options (filtering out the ones without sizes for cleaner UI)
        videoFormats.reverse().forEach(v => {
          const size = formatBytes(v.filesize || v.filesize_approx);
          const res = v.resolution || v.format_note || "Unknown";
          const fps = v.fps ? `${v.fps}fps` : "";
          // If video doesn't contain audio, merge default audio
          const fId = v.acodec === 'none' ? `${v.format_id}+bestaudio/best` : v.format_id;
          videoFormatSelect.innerHTML += `<option value="${fId}|${v.ext}">${res} ${fps} ${v.ext.toUpperCase()} (${size})</option>`;
        });

        // Populate Audio options
        audioFormats.reverse().forEach(a => {
          const size = formatBytes(a.filesize || a.filesize_approx);
          const res = a.format_note || "Audio";
          audioFormatSelect.innerHTML += `<option value="${a.format_id}|${a.ext}">${res} ${a.ext.toUpperCase()} (${size})</option>`;
        });

        fetchFormatsBtn!.textContent = "Populated!";
        setTimeout(() => { fetchFormatsBtn!.textContent = "Fetch Info"; fetchFormatsBtn!.disabled = false; }, 2000);
      } catch (err) {
        console.error("Format fetch failed", err);
        alert("Failed to fetch info: " + err);
        fetchFormatsBtn!.textContent = "Failed";
        previewContainer?.classList.add('hidden');
        setTimeout(() => { fetchFormatsBtn!.textContent = "Fetch Info"; fetchFormatsBtn!.disabled = false; }, 2000);
      }
    });
  }

  const formatOptions = document.getElementsByName('format') as NodeListOf<HTMLInputElement>;
  const videoFormatSelect = document.querySelector("#video-format") as HTMLSelectElement;
  const audioFormatSelect = document.querySelector("#audio-format") as HTMLSelectElement;

  if (formatOptions && videoFormatSelect && audioFormatSelect) {
    for (const rb of formatOptions) {
      rb.addEventListener('change', () => {
        if (rb.checked) {
          if (rb.value === 'video') {
            videoFormatSelect.classList.remove('hidden');
            audioFormatSelect.classList.add('hidden');
          } else {
            videoFormatSelect.classList.add('hidden');
            audioFormatSelect.classList.remove('hidden');
          }
        }
      });
    }
  }
});
