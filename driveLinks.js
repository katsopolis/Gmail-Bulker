/**
 * driveLinks.js — Drive link extraction and processing for Gmail Bulker
 *
 * Scans the currently opened Gmail message body for Google Drive file links
 * and provides helpers for deduplication and filename extraction.
 */

// Regex patterns for extracting Drive file IDs from various URL formats
const DRIVE_URL_PATTERNS = [
  // https://drive.google.com/file/d/FILE_ID/view
  // https://drive.google.com/file/d/FILE_ID
  /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
  // https://drive.google.com/open?id=FILE_ID
  /drive\.google\.com\/open\?[^#]*id=([a-zA-Z0-9_-]+)/,
  // https://drive.google.com/uc?id=FILE_ID
  // https://drive.google.com/uc?export=download&id=FILE_ID
  /drive\.google\.com\/uc\?[^#]*id=([a-zA-Z0-9_-]+)/
];

// Pattern to detect folder links (excluded from processing)
const DRIVE_FOLDER_PATTERN = /drive\.google\.com\/drive\/folders\//;

/**
 * Extract a Drive file ID from a URL string.
 * Returns null if the URL is not a recognized Drive file link.
 */
function extractDriveFileId(url) {
  if (!url || typeof url !== 'string') return null;

  // Exclude folder links
  if (DRIVE_FOLDER_PATTERN.test(url)) return null;

  for (const pattern of DRIVE_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  // Handle id= parameter as fallback for less common patterns
  // e.g., drive.google.com/...?id=FILE_ID
  if (url.includes('drive.google.com')) {
    const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch && idMatch[1]) {
      return idMatch[1];
    }
  }

  return null;
}

/**
 * Normalize a Drive file ID to a canonical direct-download URL.
 */
function normalizeDriveDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

/**
 * Determine if visible link text looks like a filename.
 * Returns the text if it looks like a filename, null otherwise.
 */
function looksLikeFilename(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  // Must have a dot followed by 1-10 character extension
  // and be reasonably short (not a long sentence)
  if (trimmed.length > 200) return null;
  if (trimmed.includes('\n')) return null;
  const extMatch = trimmed.match(/\.[a-zA-Z0-9]{1,10}$/);
  if (extMatch) return trimmed;
  return null;
}

/**
 * Extract a filename from a Drive link anchor element.
 * Priority:
 * 1. Visible link text if it looks like a filename
 * 2. Nearby DOM text (title attribute, aria-label)
 * 3. null (caller should use fallback)
 */
function extractFilenameFromDriveLink(anchor) {
  if (!anchor) return null;

  // Priority 1: link text that looks like a filename
  const linkText = anchor.textContent || anchor.innerText || '';
  const textFilename = looksLikeFilename(linkText);
  if (textFilename) return textFilename;

  // Priority 2: title attribute
  const title = anchor.getAttribute('title');
  const titleFilename = looksLikeFilename(title);
  if (titleFilename) return titleFilename;

  // Priority 3: aria-label
  const ariaLabel = anchor.getAttribute('aria-label');
  const ariaFilename = looksLikeFilename(ariaLabel);
  if (ariaFilename) return ariaFilename;

  // Priority 4: nearby sibling/parent text that looks like a filename
  // Check the parent element's text if it's short
  const parent = anchor.parentElement;
  if (parent) {
    const parentText = parent.textContent || '';
    if (parentText.length < 100 && parentText.length > linkText.length) {
      const parentFilename = looksLikeFilename(parentText.trim());
      if (parentFilename) return parentFilename;
    }
  }

  return null;
}

/**
 * Scan a Gmail message view DOM element for Drive file links.
 * Returns an array of Drive file objects.
 *
 * @param {Object} messageView - InboxSDK messageView object
 * @returns {Array} Array of drive file descriptor objects
 */
function extractDriveLinksFromMessageView(messageView) {
  if (!messageView) return [];

  let bodyElement = null;
  try {
    bodyElement = messageView.getBodyElement();
  } catch (e) {
    console.warn('[Gmail Bulker] Could not get message body element:', e.message);
    return [];
  }

  if (!bodyElement) return [];

  const anchors = bodyElement.querySelectorAll('a[href]');
  const driveFiles = new Map(); // keyed by fileId for deduplication

  for (const anchor of anchors) {
    const href = anchor.href || anchor.getAttribute('href') || '';
    const fileId = extractDriveFileId(href);

    if (!fileId) continue;

    // Skip if we already found this file ID (dedup within body)
    if (driveFiles.has(fileId)) {
      // But update filename if the new anchor has a better one (has a real extension)
      const existing = driveFiles.get(fileId);
      if (existing.filename.startsWith('drive_')) {
        const betterName = extractFilenameFromDriveLink(anchor);
        if (betterName) {
          existing.filename = betterName;
        }
      }
      continue;
    }

    const filename = extractFilenameFromDriveLink(anchor);

    driveFiles.set(fileId, {
      source: 'drive-body-link',
      fileId: fileId,
      url: normalizeDriveDownloadUrl(fileId),
      filename: filename || `drive_${fileId}`,
      metadata: {
        isDriveFile: true,
        attachmentType: 'DRIVE_BODY_LINK',
        fileId: fileId
      }
    });
  }

  return Array.from(driveFiles.values());
}

/**
 * Check if a Gmail message is clipped (truncated).
 * Returns the "View entire message" link URL if found, null otherwise.
 *
 * @param {Object} messageView - InboxSDK messageView object
 * @returns {string|null} The full message URL, or null if not clipped
 */
function detectClippedMessage(messageView) {
  if (!messageView) return null;

  let element = null;
  try {
    element = messageView.getBodyElement();
  } catch (e) {
    return null;
  }

  if (!element) return null;

  // Gmail uses various class names and structures for the "Message clipped" indicator.
  // Look for the common patterns.
  const messageRoot = element.closest('.gs') || element.parentElement;
  if (!messageRoot) return null;

  // Look for "View entire message" link after the body
  // Gmail places this outside the body element, in a sibling or parent container
  const container = messageRoot.parentElement || messageRoot;

  // Pattern 1: Look for a link with text containing "View entire message"
  const links = container.querySelectorAll('a');
  for (const link of links) {
    const text = (link.textContent || '').toLowerCase();
    if (text.includes('view entire message') ||
        text.includes('mesajın tamamını göster') ||
        text.includes('tüm iletiyi görüntüle')) {
      return link.href || null;
    }
  }

  // Pattern 2: Look for the Gmail clipped message div class
  const clippedDivs = container.querySelectorAll('.iX, .iFQ');
  for (const div of clippedDivs) {
    const text = (div.textContent || '').toLowerCase();
    if (text.includes('message clipped') ||
        text.includes('view entire message') ||
        text.includes('ileti kısaltıldı') ||
        text.includes('tüm iletiyi görüntüle')) {
      const link = div.querySelector('a');
      return link?.href || null;
    }
  }

  return null;
}

/**
 * Extract Drive file links from a raw HTML string.
 * Used to parse the full message HTML fetched from "View entire message" URL.
 *
 * @param {string} html - The full message HTML
 * @returns {Array} Array of drive file descriptor objects
 */
function extractDriveLinksFromHTML(html) {
  if (!html || typeof html !== 'string') return [];

  // Use regex to find all Drive links in the HTML without needing DOM parsing
  // This avoids issues with executing scripts in the parsed HTML
  const linkRegex = /href=["']([^"']*drive\.google\.com[^"']*?)["']/gi;
  const driveFiles = new Map();
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    let url = match[1];
    // Decode HTML entities
    url = url.replace(/&amp;/g, '&').replace(/&#x3d;/g, '=').replace(/&#61;/g, '=');

    const fileId = extractDriveFileId(url);
    if (!fileId) continue;
    if (driveFiles.has(fileId)) continue;

    // Try to extract filename from nearby text
    // Look for text right after the closing > of the anchor tag
    const anchorEndIndex = html.indexOf('>', match.index + match[0].length);
    if (anchorEndIndex !== -1) {
      const textAfter = html.substring(anchorEndIndex + 1, anchorEndIndex + 200);
      const textMatch = textAfter.match(/^([^<]+)/);
      if (textMatch) {
        const possibleFilename = looksLikeFilename(textMatch[1].trim());
        if (possibleFilename) {
          driveFiles.set(fileId, {
            source: 'drive-body-link',
            fileId: fileId,
            url: normalizeDriveDownloadUrl(fileId),
            filename: possibleFilename,
            metadata: {
              isDriveFile: true,
              attachmentType: 'DRIVE_BODY_LINK',
              fileId: fileId
            }
          });
          continue;
        }
      }
    }

    driveFiles.set(fileId, {
      source: 'drive-body-link',
      fileId: fileId,
      url: normalizeDriveDownloadUrl(fileId),
      filename: `drive_${fileId}`,
      metadata: {
        isDriveFile: true,
        attachmentType: 'DRIVE_BODY_LINK',
        fileId: fileId
      }
    });
  }

  return Array.from(driveFiles.values());
}

/**
 * Merge Gmail attachment objects with Drive body-link objects,
 * deduplicating by Drive file ID.
 *
 * @param {Array} gmailAttachments - Attachments from extractAttachmentData()
 * @param {Array} driveFiles - Drive files from extractDriveLinksFromMessageView()
 * @returns {Array} Merged and deduplicated array
 */
function mergeAndDeduplicateDownloads(gmailAttachments, driveFiles) {
  // Build a set of Drive file IDs already covered by Gmail attachments
  const existingDriveIds = new Set();

  for (const att of gmailAttachments) {
    // Check if the Gmail attachment URL is a Drive download URL
    if (att.url && att.url.includes('drive.google.com')) {
      const fileId = extractDriveFileId(att.url);
      if (fileId) {
        existingDriveIds.add(fileId);
      }
    }
    // Also check if metadata indicates it's a drive file and we can extract ID
    if (att.metadata && att.metadata.isDriveFile && att.url) {
      const fileId = extractDriveFileId(att.url);
      if (fileId) {
        existingDriveIds.add(fileId);
      }
    }
  }

  // Filter out Drive body-links that are already represented as Gmail attachments
  const uniqueDriveFiles = driveFiles.filter(df => !existingDriveIds.has(df.fileId));

  // Combine: Gmail attachments first, then unique Drive body-links
  return [...gmailAttachments, ...uniqueDriveFiles];
}

/**
 * Check if a fetch response is likely a binary file (not an HTML error page).
 * Returns { isBinary: boolean, reason: string }
 */
function isLikelyBinaryResponse(contentType, responseUrl) {
  if (!contentType) return { isBinary: true, reason: 'no content-type' };

  const ct = contentType.toLowerCase();

  // HTML responses are almost certainly error/login/permission pages
  if (ct.includes('text/html')) {
    // Check if the URL redirected to a login/permission page
    if (responseUrl) {
      const url = responseUrl.toLowerCase();
      if (url.includes('accounts.google.com') ||
          url.includes('consent') ||
          url.includes('ServiceLogin')) {
        return { isBinary: false, reason: 'redirected to login page' };
      }
    }
    return { isBinary: false, reason: 'response is text/html (likely permission/error page)' };
  }

  // These are clearly not file downloads
  if (ct.includes('text/plain') && !ct.includes('charset')) {
    // Could be a text file, allow it
    return { isBinary: true, reason: 'text/plain file' };
  }

  return { isBinary: true, reason: 'acceptable content-type' };
}
