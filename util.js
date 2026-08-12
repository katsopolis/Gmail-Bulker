const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;
const MAX_FILENAME_LENGTH = 180;

function sanitizeFilename(filename, fallbackBase) {
  if (typeof filename !== 'string') {
    return `${fallbackBase}_${Date.now()}.download`;
  }

  let cleaned = filename.trim().replace(INVALID_FILENAME_CHARS, '_');
  cleaned = cleaned.replace(/[\.\s]+$/g, '');

  if (!cleaned) {
    cleaned = `${fallbackBase}_${Date.now()}.download`;
  }

  if (cleaned.length > MAX_FILENAME_LENGTH) {
    const extensionMatch = cleaned.match(/(\.[^.]*)$/);
    const extension = extensionMatch ? extensionMatch[1].slice(0, 12) : '';
    const baseLength = MAX_FILENAME_LENGTH - extension.length;
    cleaned = `${cleaned.slice(0, baseLength)}${extension}`;
  }

  return cleaned;
}

function stripUrl(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const re = /^(https?:\/\/)([\w.-]+(:[\w.-]+)*@)?([\w-]+(\.[\w-]+)+)(:[0-9]+)?(\/[\w\-.~:/?#\[\]@!$&'()*+,;=]*)?$/;
  const match = url.match(re);
  return match ? match[0] : null;
}

function removeUrlImageParameters(url) {
  if (!url || typeof url !== 'string') {
    return url;
  }

  try {
    let cleanedUrl = url;

    // Remove ALL image sizing parameters - be very aggressive
    const sizePatterns = [
      // Path-based parameters (at end of URL)
      /(=s\d+(?:-[a-z0-9]+)*)$/i,
      /(=w\d+(?:-h\d+)?(?:-[a-z0-9]+)*)$/i,
      /(=h\d+(?:-w\d+)?(?:-[a-z0-9]+)*)$/i,
      /(-s\d+(?:-[a-z0-9]+)*)$/i,
      /(-w\d+(?:-h\d+)?(?:-[a-z0-9]+)*)$/i,

      // Query string parameters
      /([?&])sz=\d+/gi,
      /([?&])s=\d+/gi,
      /([?&])w=\d+/gi,
      /([?&])h=\d+/gi,
      /([?&])size=\d+/gi,
      /([?&])width=\d+/gi,
      /([?&])height=\d+/gi,

      // Display/format parameters
      /([?&])disp=inline/gi,
      /([?&])format=[^&]*/gi
    ];

    for (const pattern of sizePatterns) {
      cleanedUrl = cleanedUrl.replace(pattern, '');
    }

    // Remove trailing parameter separators
    cleanedUrl = cleanedUrl.replace(/[?&]$/, '');

    // Remove double separators
    cleanedUrl = cleanedUrl.replace(/&{2,}/g, '&');
    cleanedUrl = cleanedUrl.replace(/\?&/g, '?');

    // Remove duplicate slashes (but keep //)
    cleanedUrl = cleanedUrl.replace(/([^:])\/\//g, '$1/');

    return cleanedUrl;
  } catch (error) {
    console.error('Failed to clean URL:', url, error);
  }

  return url;
}

// Download all attachments as a single ZIP file
async function downloadAttachmentsAsZip(attachments, zipFilename = 'gmail-bulker.zip') {
  try {
    if (!attachments || attachments.length === 0) {
      throw new Error('No attachments to download');
    }

    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip library not loaded');
    }

    console.log(`Creating ZIP file with ${attachments.length} attachments...`);
    const zip = new JSZip();
    const downloadPromises = [];

    // Download each attachment and add to ZIP
    for (let i = 0; i < attachments.length; i++) {
      const attachment = attachments[i];
      const { url, filename, metadata } = attachment;

      const downloadPromise = (async () => {
        try {
          console.log(`Fetching: ${filename} (${i + 1}/${attachments.length})`);

          // Use background script to fetch the file (bypasses CORS restrictions)
          const response = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
              {
                type: 'fetchAttachmentBlob',
                payload: { url, filename }
              },
              (response) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                  return;
                }
                if (response?.status === 'error') {
                  reject(new Error(response.message));
                  return;
                }
                resolve(response);
              }
            );
          });

          if (!response || !response.data) {
            throw new Error('No data received from background script');
          }

          // Convert base64 data back to blob
          const base64Response = await fetch(response.data);
          const blob = await base64Response.blob();

          console.log(`Added to ZIP: ${filename} (${formatBytesClient(blob.size)})`);

          // Use sanitized filename to avoid ZIP issues
          const safeFilename = sanitizeFilename(filename || `attachment_${i + 1}`, `attachment_${i + 1}`);
          zip.file(safeFilename, blob);
        } catch (error) {
          console.error(`Failed to fetch ${filename}:`, error);
          // Add error note to ZIP instead of failing entirely
          zip.file(`ERROR_${filename}.txt`, `Failed to download this file: ${error.message}`);
        }
      })();

      downloadPromises.push(downloadPromise);
    }

    // Wait for all downloads to complete
    await Promise.all(downloadPromises);

    console.log('Generating ZIP file...');
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    console.log(`ZIP file created: ${formatBytesClient(zipBlob.size)}`);

    // Create download link and trigger download
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeFilename(zipFilename, 'attachments') || 'gmail-bulker.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up blob URL after a short delay
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    console.log('ZIP download started successfully!');
    return { success: true, count: attachments.length };
  } catch (error) {
    console.error('ZIP download failed:', error);
    throw error;
  }
}

// Helper function to format bytes (client-side version)
function formatBytesClient(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}