(function initializeExtension() {
  // Suppress InboxSDK non-critical errors
  const suppressedPatterns = [
    /pubsub\.googleapis\.com/i,
    /apparently already expired token/i,
    /assuming our clock is busted/i,
    /Failed to load.*googleapis\.com/i,
    /mailfoogae/i,
    /Failed to log events/i,
    /^Error logged:$/,
    /waitFor timeout/i,
    /WaitForError/i,
    /Error in injected script/i,
    /streamWaitFor/i
  ];

  const shouldSuppressArgs = (args) => {
    // Check ALL arguments, not just args[0]
    for (const arg of args) {
      let str = '';
      if (arg === null || arg === undefined) continue;
      if (arg instanceof Error) {
        str = `${arg.name}: ${arg.message} ${arg.stack || ''}`;
      } else if (typeof arg === 'object') {
        try {
          str = JSON.stringify(arg);
        } catch {
          str = String(arg);
        }
      } else {
        str = String(arg);
      }
      if (suppressedPatterns.some(pattern => pattern.test(str))) {
        return true;
      }
    }
    return false;
  };

  const originalError = console.error;
  console.error = function (...args) {
    if (!shouldSuppressArgs(args)) {
      originalError.apply(console, args);
    }
  };

  const originalWarn = console.warn;
  console.warn = function (...args) {
    if (!shouldSuppressArgs(args)) {
      originalWarn.apply(console, args);
    }
  };

  // Suppress InboxSDK uncaught exceptions (waitFor timeout, etc.)
  window.addEventListener('error', (event) => {
    if (event.error) {
      const msg = `${event.error.name || ''}: ${event.error.message || ''}`;
      if (/waitFor timeout/i.test(msg) || /WaitForError/i.test(msg)) {
        event.preventDefault();
        return true;
      }
    }
    if (event.message && /waitFor timeout/i.test(event.message)) {
      event.preventDefault();
      return true;
    }
  }, true);

  // Suppress InboxSDK unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason) {
      const msg = reason instanceof Error
        ? `${reason.name || ''}: ${reason.message || ''}`
        : String(reason);
      if (/waitFor timeout/i.test(msg) || /WaitForError/i.test(msg)) {
        event.preventDefault();
      }
    }
  });

  const start = () => {
    if (typeof InboxSDK === 'undefined' || typeof InboxSDK.load !== 'function') {
      setTimeout(start, 200);
      return;
    }

    InboxSDK.load(2, 'sdk_mlazzje-dlgmail_43a7d41655', {
      appName: 'Gmail Bulker',
      globalErrorLogging: false,
      eventTracking: false,
      suppressAddonTitle: true,
      suppressThreadRowGapFix: true
    })
      .then((sdk) => {
        if (!sdk) {
          throw new Error('InboxSDK could not be initialised');
        }

        // Helper function to trigger URL generation by interacting with attachment
        const triggerAttachmentUrlGeneration = async (attachmentCardView, index) => {
          try {
            const element = attachmentCardView.getElement();
            if (!element) return;

            // Simulate mouse hover to trigger lazy loading
            const mouseenterEvent = new MouseEvent('mouseenter', {
              view: window,
              bubbles: true,
              cancelable: true
            });
            element.dispatchEvent(mouseenterEvent);

            // Try to focus the element
            const focusableElement = element.querySelector('a, button, [tabindex]');
            if (focusableElement) {
              focusableElement.focus();
            }

            // Wait a bit for Gmail to generate URLs
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            // Silent error handling
          }
        };

        // Helper function to retry getting download URL with delay
        const getDownloadURLWithRetry = async (attachmentCardView, index, maxRetries = 1) => {
          // First, try to trigger URL generation
          await triggerAttachmentUrlGeneration(attachmentCardView, index);

          for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
              const url = await attachmentCardView.getDownloadURL();

              if (url && typeof url === 'string' && url.length > 0) {
                // Verify it's not a thumbnail URL
                if (url.includes('=s') || url.includes('sz=')) {
                  break; // Don't retry, go to DOM extraction
                }
                return url;
              }
            } catch (error) {
              // Silent error handling
            }

            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }

          return null;
        };

        // Helper function to extract attachment metadata
        const extractAttachmentMetadata = async (attachmentCardView, index) => {
          const metadata = {
            filename: null,
            type: null,
            size: null,
            attachmentType: null,
            isDriveFile: false
          };

          try {
            metadata.filename = await attachmentCardView.getTitle();
          } catch (error) {
            metadata.filename = `attachment_${index}_${Date.now()}.download`;
          }

          try {
            metadata.attachmentType = attachmentCardView.getAttachmentType();
          } catch (error) {
            // Silent error handling
          }

          try {
            const element = attachmentCardView.getElement();
            if (element) {
              // Check if this is a Drive file
              const driveLink = element.querySelector('a[href*="drive.google.com"]');
              if (driveLink) {
                metadata.isDriveFile = true;
              }
              // Try multiple methods to extract file size from DOM
              const sizeSelectors = [
                '.aZo span',           // Common Gmail attachment size container
                '.aQw span',           // Alternative Gmail attachment size
                '[role="link"] span',  // Link spans that might contain size
                '.aQw',                // Direct size container
                '.aZo',                // Alternative direct container
                'span[title]',         // Spans with title attributes
                'div[aria-label] span' // Divs with aria labels
              ];

              for (const selector of sizeSelectors) {
                const sizeElements = element.querySelectorAll(selector);
                for (const sizeElement of sizeElements) {
                  if (sizeElement && sizeElement.textContent) {
                    const text = sizeElement.textContent.trim();
                    // Match patterns like "(1.5 MB)", "1.5 MB", "1.5MB", "1.5 KB", etc.
                    const sizeMatch = text.match(/\(?(\d+\.?\d*\s*[KMGT]?B)\)?/i);
                    if (sizeMatch) {
                      metadata.size = sizeMatch[1].trim();
                      break;
                    }
                  }
                }
                if (metadata.size) break;
              }

              // Try to extract MIME type from DOM or filename
              const extension = metadata.filename?.split('.').pop()?.toLowerCase();
              if (extension) {
                metadata.type = inferMimeTypeFromExtension(extension);
              }
            }
          } catch (error) {
            // Silent error handling
          }

          return metadata;
        };

        // Helper function to infer MIME type from file extension
        const inferMimeTypeFromExtension = (extension) => {
          const mimeTypes = {
            'pdf': 'application/pdf',
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls': 'application/vnd.ms-excel',
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'ppt': 'application/vnd.ms-powerpoint',
            'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'bmp': 'image/bmp',
            'svg': 'image/svg+xml',
            'webp': 'image/webp',
            'txt': 'text/plain',
            'csv': 'text/csv',
            'html': 'text/html',
            'htm': 'text/html',
            'zip': 'application/zip',
            'rar': 'application/x-rar-compressed',
            '7z': 'application/x-7z-compressed',
            'tar': 'application/x-tar',
            'gz': 'application/gzip',
            'mp3': 'audio/mpeg',
            'mp4': 'video/mp4',
            'avi': 'video/x-msvideo',
            'mov': 'video/quicktime',
            'json': 'application/json',
            'xml': 'application/xml'
          };
          return mimeTypes[extension] || null;
        };

        // Helper function to extract URL from DOM with improved logic
        const extractUrlFromDOM = (element, index) => {
          if (!element) {
            return null;
          }

          // Find all links and images in the attachment card and parent elements
          const allLinks = element.querySelectorAll('a');
          const allImages = element.querySelectorAll('img');

          // Priority 1: Google Drive links (HIGHEST PRIORITY for Drive-shared attachments)
          for (const link of allLinks) {
            if (link.href && link.href.includes('drive.google.com/file/d/')) {
              // Extract file ID and convert to direct download URL
              const driveMatch = link.href.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
              if (driveMatch && driveMatch[1]) {
                const fileId = driveMatch[1];
                // Convert view URL to direct download URL
                const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
                return downloadUrl;
              }
            }
          }

          // Priority 2: Download link with explicit download attribute
          const downloadLink = element.querySelector('a[download][href*="googleusercontent.com"]');
          if (downloadLink?.href) {
            return downloadLink.href;
          }

          // Priority 3: Direct mail-attachment URL
          const attachmentLink = element.querySelector('a[href*="mail-attachment.googleusercontent.com"]');
          if (attachmentLink?.href) {
            return attachmentLink.href;
          }

          // Priority 4: Look for redirect URLs that Gmail uses (common pattern)
          const redirectLink = element.querySelector('a[href*="/mail/"][href*="view=att"]');
          if (redirectLink?.href) {
            return redirectLink.href;
          }

          // Priority 5: Look for attachment ID in Gmail URL structure
          const gmailAttLink = element.querySelector('a[href*="attid="]');
          if (gmailAttLink?.href) {
            return gmailAttLink.href;
          }

          // Priority 6: Look for any link that contains "disp=attd" (disposition: attachment)
          const dispAttLink = element.querySelector('a[href*="disp=attd"]');
          if (dispAttLink?.href) {
            return dispAttLink.href;
          }

          // Priority 7: Look for ANY googleusercontent link that's not a thumbnail
          for (const link of allLinks) {
            if (link.href && link.href.includes('googleusercontent.com')) {
              const isThumbnail = link.href.includes('=s') || link.href.includes('sz=') ||
                link.href.includes('=w') || link.href.includes('=h');
              if (!isThumbnail) {
                return link.href;
              }
            }
          }

          // Priority 8: Look for ANY Gmail mail link
          const gmailLink = element.querySelector('a[href*="/mail/"]');
          if (gmailLink?.href) {
            const href = gmailLink.href;
            if (href.includes('view=') || href.includes('attid=') || href.includes('attach')) {
              return href;
            }
          }

          // Priority 9: Try to find ANY googleusercontent link and clean it
          const anyGoogleLink = element.querySelector('a[href*="googleusercontent.com"]');
          if (anyGoogleLink?.href) {
            const cleanedUrl = removeUrlImageParameters(anyGoogleLink.href);
            return cleanedUrl;
          }

          // Priority 10: Check image sources and clean them (last resort)
          for (const img of allImages) {
            if (img.src && img.src.includes('googleusercontent.com')) {
              const cleanedUrl = removeUrlImageParameters(img.src);
              return cleanedUrl;
            }
          }

          return null;
        };

        // Helper function to validate download URL quality
        const validateDownloadUrl = (url) => {
          const result = {
            isProxy: false,
            isThumbnail: false,
            hasParameters: false,
            isDrive: false
          };

          if (!url) return result;

          // Check if it's a Drive URL (these are always valid)
          if (url.includes('drive.google.com/uc?export=download')) {
            result.isDrive = true;
            return result; // Drive URLs are always good, skip other checks
          }

          // Check for thumbnail/proxy indicators
          if (url.includes('=s') || url.includes('=w') || url.includes('=h')) {
            result.isThumbnail = true;
          }

          if (url.includes('/sz=') || url.includes('&sz=')) {
            result.isThumbnail = true;
          }

          if (url.includes('&disp=inline') || url.includes('?disp=inline')) {
            result.isProxy = true;
          }

          if (url.includes('?') || url.includes('&')) {
            result.hasParameters = true;
          }

          return result;
        };

        // Extract attachment URLs and metadata
        const extractAttachmentData = async (views) => {
          const attachments = [];

          for (let index = 0; index < views.length; index++) {
            const attachmentCardView = views[index];
            if (!attachmentCardView) {
              continue;
            }

            try {
              // Extract attachment metadata
              const metadata = await extractAttachmentMetadata(attachmentCardView, index);

              // Try to get download URL with retry logic
              let downloadUrl = await getDownloadURLWithRetry(attachmentCardView, index + 1);

              // If InboxSDK retry failed, use DOM fallback
              if (!downloadUrl) {
                try {
                  const element = attachmentCardView.getElement();
                  if (element) {
                    downloadUrl = extractUrlFromDOM(element, index + 1);
                  }
                } catch (error) {
                  // Silent error handling
                }
              }

              if (!downloadUrl) {
                throw new Error(`No download URL found for "${metadata.filename}" (index ${index}).`);
              }

              // Validate URL quality
              const urlQuality = validateDownloadUrl(downloadUrl);

              attachments.push({
                url: downloadUrl,
                filename: metadata.filename,
                metadata: metadata
              });
            } catch (error) {
              // Silent error handling, skip this attachment
            }
          }

          return attachments;
        };

        // Handler for downloading all attachments + Drive body links as ZIP
        const handleAttachmentsZipButtonClick = async (event) => {
          const views = event?.attachmentCardViews || [];
          const messageView = event?.messageView || null;

          try {
            // Step 1: Extract standard Gmail attachments (existing flow, unchanged)
            const gmailAttachments = await extractAttachmentData(views);

            // Step 2: Extract Drive links from the email body
            let bodyDriveFiles = [];
            if (messageView) {
              bodyDriveFiles = extractDriveLinksFromMessageView(messageView);

              // Step 2b: If message is clipped, fetch full message and extract remaining links
              const clippedUrl = detectClippedMessage(messageView);
              if (clippedUrl) {
                console.log('[Gmail Bulker] Message is clipped, fetching full message...');
                try {
                  const fullHtml = await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage(
                      { type: 'fetchFullMessageHTML', payload: { url: clippedUrl } },
                      (resp) => {
                        if (chrome.runtime.lastError) {
                          reject(new Error(chrome.runtime.lastError.message));
                          return;
                        }
                        if (resp?.status === 'error') {
                          reject(new Error(resp.message));
                          return;
                        }
                        resolve(resp.html);
                      }
                    );
                  });

                  const fullMessageDriveFiles = extractDriveLinksFromHTML(fullHtml);
                  console.log(`[Gmail Bulker] Full message has ${fullMessageDriveFiles.length} Drive file(s)`);

                  // Merge: full message files include everything, so use them as the primary source
                  // but keep any files from visible DOM that might have better filenames
                  const existingIds = new Set(bodyDriveFiles.map(f => f.fileId));
                  for (const file of fullMessageDriveFiles) {
                    if (!existingIds.has(file.fileId)) {
                      bodyDriveFiles.push(file);
                    }
                  }
                } catch (error) {
                  console.warn('[Gmail Bulker] Could not fetch full message:', error.message);
                  // Continue with what we have from the visible DOM
                }
              }
            }

            // Step 3: Merge and deduplicate
            const allFiles = mergeAndDeduplicateDownloads(gmailAttachments, bodyDriveFiles);

            if (allFiles.length === 0) {
              alert('No attachments or Drive files found to download.');
              return;
            }

            // Step 4: (Clipped message already handled in Step 2b above)

            // Step 5: Show feedback about what was found
            const gmailCount = gmailAttachments.length;
            const driveCount = allFiles.length - gmailCount;
            if (driveCount > 0) {
              console.log(`[Gmail Bulker] Found ${gmailCount} Gmail attachment(s) and ${driveCount} Drive file(s)`);
            } else {
              console.log(`[Gmail Bulker] Found ${gmailCount} Gmail attachment(s)`);
            }

            // Step 6: Generate ZIP filename and download
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const zipFilename = `gmail-bulker-${timestamp}.zip`;

            await downloadAllFilesAsZip(allFiles, zipFilename);

            console.log(`[Gmail Bulker] ZIP created with ${allFiles.length} files`);
          } catch (error) {
            console.error('[Gmail Bulker] ZIP download error:', error);
            alert(`Failed to create ZIP file: ${error.message}`);
          }
        };

        /**
         * Download all files (Gmail attachments + Drive body links) into a single ZIP.
         * Uses the existing fetchAttachmentBlob for Gmail attachments, and
         * fetchDriveFile for Drive body links.
         */
        const downloadAllFilesAsZip = async (allFiles, zipFilename) => {
          if (!allFiles || allFiles.length === 0) {
            throw new Error('No files to download');
          }

          if (typeof JSZip === 'undefined') {
            throw new Error('JSZip library not loaded');
          }

          const zip = new JSZip();
          let successCount = 0;
          let failCount = 0;

          const downloadPromises = allFiles.map((file, i) => (async () => {
            const { url, filename, metadata } = file;
            const isDriveBodyLink = metadata?.attachmentType === 'DRIVE_BODY_LINK';

            try {
              const safeFilename = sanitizeFilename(
                filename || `file_${i + 1}`,
                `file_${i + 1}`
              );

              let response;
              if (isDriveBodyLink) {
                // Use the dedicated Drive file fetcher with validation
                response = await new Promise((resolve, reject) => {
                  chrome.runtime.sendMessage(
                    {
                      type: 'fetchDriveFile',
                      payload: { url, filename: safeFilename, fileId: metadata.fileId || file.fileId }
                    },
                    (resp) => {
                      if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                      }
                      if (resp?.status === 'error') {
                        reject(new Error(resp.message));
                        return;
                      }
                      resolve(resp);
                    }
                  );
                });

                // Use resolved filename from Content-Disposition if available
                const finalFilename = sanitizeFilename(
                  response.resolvedFilename || safeFilename,
                  safeFilename
                );

                const base64Response = await fetch(response.data);
                const blob = await base64Response.blob();
                zip.file(finalFilename, blob);
              } else {
                // Use existing fetchAttachmentBlob for Gmail attachments (unchanged)
                response = await new Promise((resolve, reject) => {
                  chrome.runtime.sendMessage(
                    {
                      type: 'fetchAttachmentBlob',
                      payload: { url, filename: safeFilename }
                    },
                    (resp) => {
                      if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                      }
                      if (resp?.status === 'error') {
                        reject(new Error(resp.message));
                        return;
                      }
                      resolve(resp);
                    }
                  );
                });

                const base64Response = await fetch(response.data);
                const blob = await base64Response.blob();
                zip.file(safeFilename, blob);
              }

              successCount++;
            } catch (error) {
              failCount++;
              console.warn('[Gmail Bulker] File download failed:', {
                filename,
                source: isDriveBodyLink ? 'drive-body-link' : 'gmail-attachment',
                reason: error.message
              });
              // Add error note to ZIP instead of stopping the whole process
              const errorFilename = sanitizeFilename(
                `ERROR_${filename || 'file_' + (i + 1)}.txt`,
                `ERROR_file_${i + 1}.txt`
              );
              zip.file(errorFilename, `Failed to download: ${filename}\nSource: ${isDriveBodyLink ? 'Drive body link' : 'Gmail attachment'}\nError: ${error.message}`);
            }
          })());

          await Promise.all(downloadPromises);

          if (successCount === 0 && failCount > 0) {
            throw new Error(`All ${failCount} file(s) failed to download. Check permissions.`);
          }

          // Generate and download ZIP
          const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
          });

          const blobUrl = URL.createObjectURL(zipBlob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = sanitizeFilename(zipFilename, 'attachments') || 'gmail-bulker.zip';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);

          if (failCount > 0) {
            console.warn(`[Gmail Bulker] Downloaded ${successCount} of ${successCount + failCount} files. See error files inside the ZIP.`);
          }
        };

        // Handler for the Drive-only button (when no attachment cards exist)
        const handleDriveOnlyButtonClick = async (messageView) => {
          // Simulate an event-like object with empty attachmentCardViews
          await handleAttachmentsZipButtonClick({
            attachmentCardViews: [],
            messageView: messageView
          });
        };

        const addCustomAttachmentsToolbarButton = (messageView) => {
          try {
            // Add "Download all as ZIP" button on the attachments toolbar
            messageView.addAttachmentsToolbarButton({
              tooltip: 'Download all attachments and Drive files as ZIP',
              iconUrl: chrome.runtime.getURL('img/save.png'),
              onClick: handleAttachmentsZipButtonClick
            });
          } catch (error) {
            // Silent error handling — button won't appear if no attachment toolbar
          }
        };

        /**
         * Add a secondary button directly into the message DOM when no
         * attachment cards exist but Drive links are found in the body.
         * InboxSDK doesn't have an API for adding buttons to messages
         * without attachments, so we inject a button into the DOM.
         */
        const addDriveBodyLinkButton = (messageView) => {
          try {
            // Check if there are Drive links in this message body
            const driveFiles = extractDriveLinksFromMessageView(messageView);
            if (driveFiles.length === 0) return;

            // Get the message body element to inject the button nearby
            const bodyElement = messageView.getBodyElement();
            if (!bodyElement) return;

            // Don't add button if already added
            if (bodyElement.parentElement?.querySelector('.gmail-bulker-drive-btn')) return;

            // Create a button bar that appears above the message body
            const btnContainer = document.createElement('div');
            btnContainer.className = 'gmail-bulker-drive-btn';
            btnContainer.style.cssText = 'padding: 8px 0; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;';

            const btn = document.createElement('button');
            btn.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; ' +
              'border: 1px solid #dadce0; border-radius: 18px; background: #fff; color: #1a73e8; ' +
              'font-family: "Google Sans", Roboto, sans-serif; font-size: 13px; font-weight: 500; ' +
              'cursor: pointer; transition: background 0.2s;';
            btn.onmouseenter = () => { btn.style.background = '#f1f3f4'; };
            btn.onmouseleave = () => { btn.style.background = '#fff'; };

            // Icon
            const img = document.createElement('img');
            img.src = chrome.runtime.getURL('img/save.png');
            img.style.cssText = 'width: 16px; height: 16px;';
            btn.appendChild(img);

            // Text
            const span = document.createElement('span');
            span.textContent = `Download ${driveFiles.length} Drive file(s) as ZIP`;
            btn.appendChild(span);

            btn.addEventListener('click', async (e) => {
              e.preventDefault();
              e.stopPropagation();
              btn.disabled = true;
              span.textContent = 'Scanning for all Drive files...';
              try {
                await handleDriveOnlyButtonClick(messageView);
                span.textContent = 'Done!';
              } catch (err) {
                span.textContent = `Error: ${err.message}`;
              } finally {
                btn.disabled = false;
                setTimeout(() => {
                  span.textContent = `Download ${driveFiles.length} Drive file(s) as ZIP`;
                }, 3000);
              }
            });

            btnContainer.appendChild(btn);

            // Insert before the body element
            bodyElement.parentElement.insertBefore(btnContainer, bodyElement);
          } catch (error) {
            // Non-critical — log but don't break
            console.warn('[Gmail Bulker] Could not add Drive button:', error.message);
          }
        };

        const messageViewHandler = (messageView) => {
          try {
            if (messageView?.isLoaded()) {
              addCustomAttachmentsToolbarButton(messageView);
              addDriveBodyLinkButton(messageView);
            }
          } catch (error) {
            // Silent error handling
          }
        };

        sdk.Conversations.registerMessageViewHandler(messageViewHandler);
      })
      .catch((error) => {
        // Silent error handling - extension will fail gracefully
      });
  };
  start();
})();