chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === 'inboxsdk__injectPageWorld' && sender.tab) {
    if (!chrome.scripting) {
      sendResponse({ ok: false, error: 'scripting API unavailable' });
      return;
    }

    let documentIds;
    let frameIds;
    if (sender.documentId) {
      documentIds = [sender.documentId];
    } else if (typeof sender.frameId === 'number') {
      frameIds = [sender.frameId];
    }

    chrome.scripting.executeScript(
      {
        target: { tabId: sender.tab.id, documentIds, frameIds },
        world: 'MAIN',
        files: ['pageWorld.js']
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error('pageWorld injection failed:', chrome.runtime.lastError.message);
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true });
        }
      }
    );

    return true;
  }

  if (message.type === 'downloadAttachment') {
    const { url, filename, metadata } = message.payload;

    // Log download request with metadata
    if (metadata) {
      console.log('Download request received:', {
        filename,
        size: metadata.size || 'unknown',
        type: metadata.type || 'unknown',
        attachmentType: metadata.attachmentType || 'unknown',
        url: url.substring(0, 100) + '...'
      });
    } else {
      console.log('Download request received:', url, filename);
    }

    if (!url || !filename) {
      console.error('Invalid download request: missing URL or filename.');
      sendResponse({ status: 'error', message: 'URL or filename missing' });
      return;
    }

    // Validate URL format
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      console.error('Invalid URL format:', url);
      sendResponse({ status: 'error', message: 'Invalid URL format' });
      return;
    }

    chrome.downloads.download(
      {
        url,
        filename,
        saveAs: false,
        conflictAction: 'uniquify'
      },
      (downloadId) => {
        if (chrome.runtime.lastError || typeof downloadId === 'undefined') {
          const errorMsg = chrome.runtime.lastError?.message || 'Download could not be started';
          console.error(`Download failed for '${filename}':`, errorMsg);
          sendResponse({
            status: 'error',
            message: errorMsg
          });
        } else {
          console.log(`'${filename}' download started, ID:`, downloadId);

          // Track download progress if metadata is available
          if (metadata && downloadId) {
            trackDownloadProgress(downloadId, filename, metadata);
          }

          sendResponse({ status: 'success', downloadId });
        }
      }
    );

    return true;
  }

  if (message.type === 'fetchAttachmentBlob') {
    const { url, filename } = message.payload;

    if (!url) {
      sendResponse({ status: 'error', message: 'URL is required' });
      return;
    }

    console.log(`Fetching blob for ZIP: ${filename}`);

    // Use fetch API from background script (has more permissions, bypasses CORS)
    fetch(url)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.blob();
      })
      .then(blob => {
        // Convert blob to base64 so we can send it via message
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64data = reader.result;
          console.log(`Blob fetched successfully: ${filename} (${formatBytes(blob.size)})`);
          sendResponse({
            status: 'success',
            data: base64data,
            size: blob.size,
            type: blob.type
          });
        };
        reader.onerror = () => {
          console.error(`Failed to read blob for ${filename}`);
          sendResponse({
            status: 'error',
            message: 'Failed to read blob data'
          });
        };
        reader.readAsDataURL(blob);
      })
      .catch(error => {
        console.error(`Failed to fetch ${filename}:`, error);
        sendResponse({
          status: 'error',
          message: error.message || 'Failed to fetch'
        });
      });

    return true; // Keep message channel open for async response
  }

  if (message.type === 'fetchFullMessageHTML') {
    const { url } = message.payload;

    if (!url) {
      sendResponse({ status: 'error', message: 'URL is required' });
      return;
    }

    console.log('[Gmail Bulker] Fetching full message HTML for clipped message');

    fetch(url, { credentials: 'include', redirect: 'follow' })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.text();
      })
      .then(html => {
        console.log(`[Gmail Bulker] Full message HTML fetched (${html.length} chars)`);
        sendResponse({ status: 'success', html: html });
      })
      .catch(error => {
        console.warn('[Gmail Bulker] Failed to fetch full message:', error.message);
        sendResponse({ status: 'error', message: error.message });
      });

    return true;
  }

  if (message.type === 'fetchDriveFile') {
    const { url, filename, fileId } = message.payload;

    if (!url || !fileId) {
      sendResponse({ status: 'error', message: 'URL and fileId are required' });
      return;
    }

    console.log(`[Gmail Bulker] Fetching Drive file: ${filename} (${fileId})`);

    fetchDriveFileWithValidation(url, filename, fileId)
      .then(result => sendResponse(result))
      .catch(error => {
        console.warn('[Gmail Bulker] Drive file fetch failed:', { fileId, filename, reason: error.message });
        sendResponse({
          status: 'error',
          message: error.message || 'Failed to fetch Drive file'
        });
      });

    return true; // Keep message channel open for async response
  }

  // Unknown message type — return false to not keep the channel open
  return false;
});

/**
 * Fetch a Drive file with response validation.
 * Detects HTML error pages (permission, login, virus scan) and
 * returns a clear error instead of silently saving HTML as a binary file.
 *
 * Also attempts to extract the real filename from Content-Disposition header.
 */
async function fetchDriveFileWithValidation(url, filename, fileId) {
  // First attempt: direct download URL
  let response = await fetch(url, {
    redirect: 'follow',
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const contentDisposition = response.headers.get('content-disposition') || '';
  const finalUrl = response.url || url;

  // Validate the response is not an HTML error/permission page
  const ct = contentType.toLowerCase();
  if (ct.includes('text/html')) {
    // Check if redirected to login/consent page
    if (finalUrl.includes('accounts.google.com') ||
        finalUrl.includes('ServiceLogin') ||
        finalUrl.includes('consent')) {
      throw new Error('Drive file requires authentication — user may need to sign in to Google');
    }

    // Could be a virus scan confirmation page — try the confirm=t workaround
    const confirmUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
    if (url !== confirmUrl) {
      response = await fetch(confirmUrl, {
        redirect: 'follow',
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} after virus scan bypass attempt`);
      }

      const retryContentType = (response.headers.get('content-type') || '').toLowerCase();
      if (retryContentType.includes('text/html')) {
        throw new Error('Drive file is not accessible — permission denied or virus scan block');
      }
    } else {
      throw new Error('Drive file returned HTML instead of binary — likely a permission or sharing issue');
    }
  }

  // Try to extract real filename from Content-Disposition
  let resolvedFilename = filename;
  if (contentDisposition) {
    const cdMatch = contentDisposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/i);
    if (cdMatch && cdMatch[1]) {
      try {
        resolvedFilename = decodeURIComponent(cdMatch[1].replace(/\+/g, ' '));
      } catch (e) {
        resolvedFilename = cdMatch[1];
      }
    }
  }

  // Convert response to blob and then to base64
  const blob = await response.blob();

  if (blob.size === 0) {
    throw new Error('Drive file response was empty (0 bytes)');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      console.log(`[Gmail Bulker] Drive file fetched: ${resolvedFilename} (${formatBytes(blob.size)})`);
      resolve({
        status: 'success',
        data: reader.result,
        size: blob.size,
        type: blob.type || contentType,
        resolvedFilename: resolvedFilename
      });
    };
    reader.onerror = () => {
      reject(new Error('Failed to read Drive file blob data'));
    };
    reader.readAsDataURL(blob);
  });
}

// Track download progress and log completion
function trackDownloadProgress(downloadId, filename, metadata) {
  chrome.downloads.search({ id: downloadId }, (results) => {
    if (results && results.length > 0) {
      chrome.downloads.onChanged.addListener(function listener(delta) {
        if (delta.id === downloadId) {
          if (delta.state && delta.state.current === 'complete') {
            console.log(`Download completed: ${filename}`);

            // Get final download info
            chrome.downloads.search({ id: downloadId }, (finalResults) => {
              if (finalResults && finalResults.length > 0) {
                const finalDownload = finalResults[0];
                const actualSize = finalDownload.fileSize;

                if (metadata.size && actualSize) {
                  console.log(`Size verification for ${filename}: Expected ${metadata.size}, Actual ${formatBytes(actualSize)}`);
                }
              }
            });

            chrome.downloads.onChanged.removeListener(listener);
          } else if (delta.error) {
            console.error(`Download error for ${filename}:`, delta.error.current);
            chrome.downloads.onChanged.removeListener(listener);
          }
        }
      });
    }
  });
}

// Helper function to format bytes
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Gmail Bulker active - v1.1.0');
});