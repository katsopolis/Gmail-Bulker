![Extension logo](img/logo_128-revert.png) ﻿<h1>Gmail Bulker</h1>

Gmail Bulker adds a toolbar button that downloads every attachment in the open Gmail conversation as a single ZIP file, preserving each file's original name, format, and size.

## Key Features
- **ZIP Download**: Bundles all attachments into a single ZIP file for convenient bulk download
- **InboxSDK Integration**: Uses Gmail's official attachment download URLs instead of thumbnail proxies
- **Google Drive Support**: Downloads Drive-shared attachments using background service worker to bypass CORS restrictions
- **Filename Sanitization**: Ensures Chrome writes the exact Gmail title safely to disk
- **Smart Fallbacks**: Uses DOM metadata extraction when Gmail delays the download URL
- **JSZip Integration**: Creates ZIP archives client-side with proper file handling

## Preview
Below is the toolbar button added by the extension:

![Toolbar button](img/screenshot1.png)

## Installation
1. Download or clone this repository (Gmail-Bulker).
2. Open chrome://extensions in a Chromium-based browser and enable **Developer mode**.
3. Choose **Load unpacked** and select the Gmail-Bulker folder.

## Usage
1. Open any Gmail thread that contains attachments.
2. Click the **"Download all as ZIP"** button that appears in the attachments toolbar.
3. The extension will fetch all attachments (including Google Drive files) and bundle them into a single ZIP file.
4. The ZIP file will be automatically downloaded with a timestamp-based filename (e.g., `gmail-bulker-2025-10-31T12-30-45.zip`).

## Manifest Notes
- Manifest V3 now ships with an inline description and author credit, removing the need for locale message bundles.
- Background downloads return explicit success or error responses, keeping the message channel stable during bulk transfers.
- Extension version is **1.0.5**.

## Recent Updates

### Version 1.0.5 - Stability & Console Cleanup (Latest)
- **InboxSDK Error Suppression**: Fixed console.error override to check all arguments (not just args[0]), properly catching InboxSDK's internal pubsub telemetry errors
- **Message Handler Hardening**: Unknown message types in background.js now return `false` to prevent "message port closed" warnings
- **Removed Aggressive URL Cleaning**: Eliminated path-segment patterns (`/s\d+`, `/w\d+`, `/h\d+`) that could corrupt legitimate download URLs
- **Dead Code Removal**: Removed unused `downloadAttachment()` function (superseded by ZIP flow)
- **Console Noise Reduction**: Removed verbose logging from URL cleaning

### Version 1.0.3 - ZIP Download & Drive Support
- **ZIP Archive Download**: All attachments are now bundled into a single ZIP file for easier bulk download
- **Google Drive CORS Bypass**: Implements background service worker to successfully download Drive-shared attachments
- **Simplified UI**: Single "Download all as ZIP" button replaces separate download options
- **JSZip Integration**: Client-side ZIP creation with proper binary file handling
- **Timestamp-based Naming**: ZIP files automatically named with ISO timestamp for easy organization
- **Drive Host Permissions**: Added `drive.google.com` to manifest permissions for seamless Drive file access

### Version 1.0.2 - Performance & Analysis Optimization
- **Metadata Extraction**: Extracts and logs file size, MIME type, and attachment type for each download
- **URL Validation**: Detects and warns about proxy/thumbnail URLs that may differ from original files
- **Enhanced URL Cleaning**: Improved parameter removal to prevent downloading thumbnails instead of full files
- **Download Tracking**: Real-time progress monitoring with size verification after download completion
- **Better Error Handling**: Replaced Turkish error messages with English, added detailed logging throughout
- **DOM Fallback Improvements**: Prioritized URL extraction logic to prefer original file URLs over thumbnails
- **File Type Detection**: Infers MIME types from file extensions with support for 30+ common formats

### Previous Updates
- Rebranded the project and extension as **Gmail Bulker** with refreshed toolbar icons
- Ensured every attachment download depends on InboxSDK getDownloadURL() before touching the DOM
- Added URL normalisation, filename sanitisation, and DOM fallbacks to avoid JPEG/WebP proxy downloads
- Logged informative warnings when Gmail withholds a Drive URL
- Normalised the toolbar icon CSS so the download button aligns with Gmail's native Drive action

## How It Works

### Architecture Overview
The extension operates as a Chrome Manifest V3 extension with three main components:

1. **Content Script (app.js)**
   - Integrates with Gmail via InboxSDK to detect and interact with email attachments
   - Extracts attachment metadata (filename, size, MIME type) from Gmail's DOM
   - Implements smart URL extraction with multiple fallback strategies
   - Coordinates ZIP creation and initiates background downloads for Drive files

2. **Background Service Worker (background.js)**
   - Handles CORS-restricted downloads (primarily Google Drive files)
   - Acts as a proxy to bypass cross-origin restrictions
   - Fetches files as ArrayBuffer and returns binary data to content script
   - Maintains stable message channel for bulk transfer operations

3. **ZIP Creation (JSZip)**
   - Bundles all attachments into a single archive client-side
   - Handles both direct downloads and background-fetched files
   - Preserves original filenames and folder structure
   - Generates downloadable Blob for browser's native download mechanism

### Attachment Download Flow

1. **Detection Phase**
   - InboxSDK detects message view with attachments
   - Extension adds "Download all as ZIP" button to attachments toolbar

2. **URL Extraction Phase**
   - For each attachment, attempts `getDownloadURL()` via InboxSDK API
   - If unavailable, triggers DOM interaction (hover, focus) to lazy-load URLs
   - Implements retry logic with exponential backoff
   - Falls back to multi-priority DOM extraction when API fails

3. **URL Priority System**
   ```
   Priority 1: Google Drive direct download URLs (drive.google.com/uc?export=download)
   Priority 2: Download links with explicit download attribute
   Priority 3: mail-attachment.googleusercontent.com URLs
   Priority 4: Gmail redirect URLs with view=att parameter
   Priority 5: Gmail URLs with attid parameter
   Priority 6: URLs with disp=attd (disposition: attachment)
   Priority 7: Non-thumbnail googleusercontent.com URLs
   Priority 8: Gmail mail links with attachment indicators
   Priority 9: Cleaned googleusercontent.com URLs (parameter stripped)
   Priority 10: Cleaned image sources (last resort)
   ```

4. **Download Phase**
   - **Drive Files**: Routed through background worker to bypass CORS
   - **Gmail Attachments**: Direct fetch from content script
   - All downloads converted to ArrayBuffer for consistent handling

5. **ZIP Creation & Download**
   - JSZip bundles all successful downloads
   - Generates timestamped filename (ISO 8601 format)
   - Creates Blob and triggers browser download
   - Cleans up object URLs after download initiation

### URL Quality Detection
The extension validates download URLs and warns about potential issues:
- Detects image sizing parameters (=s, =w, =h, sz=)
- Identifies proxy indicators (&disp=inline)
- Prioritizes mail-attachment.googleusercontent.com URLs over image proxies
- Enhanced parameter stripping to ensure original file download

### Drive File Handling
Special handling for Google Drive shared attachments:
- Converts Drive view URLs to export/download format
- Extracts file IDs from various Drive URL patterns
- Uses background worker to avoid CORS errors
- Maintains original filename from Gmail metadata

## License
This project is released under the MIT License. See [LICENSE](LICENSE) for details.

## Author
Katsopolis
