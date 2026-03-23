# yt-dlp-gui (Tauri + TypeScript)

This is a GUI application built with Tauri and TypeScript for downloading media using yt-dlp.

## Prerequisites

Before building or developing, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (latest LTS recommended)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (must be in your system's PATH)
- [FFmpeg](https://ffmpeg.org/) (must be in your system's PATH)

## Development

To start the development environment:

1. Install dependencies:
   ```bash
   npm install
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```

3. Launch the Tauri application:
   ```bash
   npm run tauri dev
   ```

## Building

To build the application for production:

1. Build the production version:
   ```bash
   npm run tauri build
   ```

The output binaries will be located in `src-tauri/target/release/bundle/`.

## Project Structure

- `src/`: Frontend TypeScript and CSS files.
- `src-tauri/`: Backend Rust files and Tauri configuration.
- `assets/`: Project assets.
