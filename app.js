(function initializeExtension() {
  // Suppress InboxSDK non-critical errors
  const suppressedPatterns = [
    /pubsub\.googleapis\.com/i,
    /apparently already expired token/i,
    /assuming our clock is busted/i,
    /Failed to load.*googleapis\.com/i,
    /mailfoogae/i,
    /Failed to log events/i,
    /^Error logged:$/
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

        // Handler for downloading all attachments as ZIP
        const handleAttachmentsZipButtonClick = async (event) => {
          const views = event?.attachmentCardViews;
          if (!Array.isArray(views) || views.length === 0) {
            return;
          }

          try {
            const attachments = await extractAttachmentData(views);

            if (attachments.length === 0) {
              alert('No attachments found to download.');
              return;
            }

            // Generate filename based on email subject or date
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const zipFilename = `gmail-bulker-${timestamp}.zip`;

            await downloadAttachmentsAsZip(attachments, zipFilename);

            // Optional: Show success message
            console.log(`Successfully created ZIP with ${attachments.length} attachments`);
          } catch (error) {
            console.error('ZIP download error:', error);
            alert(`Failed to create ZIP file: ${error.message}`);
          }
        };

        const addCustomAttachmentsToolbarButton = (messageView) => {
          try {
            // Add "Download all as ZIP" button
            messageView.addAttachmentsToolbarButton({
              tooltip: 'Download all as ZIP',
              iconUrl: chrome.runtime.getURL('img/save.png'),
              onClick: handleAttachmentsZipButtonClick
            });
          } catch (error) {
            // Silent error handling
          }
        };

        const messageViewHandler = (messageView) => {
          try {
            if (messageView?.isLoaded()) {
              addCustomAttachmentsToolbarButton(messageView);
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