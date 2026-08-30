# Gmail Bulker Services

Reviewed against local source: 30 August 2026. This inventory describes configuration and trust boundaries, not verified live deployment health.

## Service map

| Service | Role / current boundary | Source |
| --- | --- | --- |
| Gmail / InboxSDK | Runs in an already authenticated Gmail page to discover attachment URLs. | [Implementation](app.js) |
| Google Drive download endpoints | Background download path for accessible Drive links. | [Implementation](background.js) |
| Chrome extension APIs | Storage, downloads and scripting permissions; not an independent backend service. | [Implementation](manifest.json) |

## Configuration and trust boundaries

- The authoritative host/permission list is [manifest.json](manifest.json); access is limited to the user's authenticated session and permitted hosts.
- InboxSDK IDs and browser API client identifiers are not server secrets. Any browser-visible Google key must be restricted to the intended API/origin/quotas in its provider console; this document does not verify console restrictions.
- Do not put Gmail cookies, OAuth tokens, private attachment URLs or downloaded mail in logs, screenshots, fixtures or Git. The extension is an attachment downloader, not an automated bulk-mail sender.

## Verification before enabling or deploying

- With an authorized test mailbox, check attachments, Drive body links, duplicate filenames and clipped-message retrieval.
- Check permission denial, expired session and an inaccessible Drive link; HTML login/error pages must not become a successful ZIP entry.
- No live message sending or bulk downloading is needed for a documentation check. Review broad error suppression when diagnosing failures.

## Ownership and operations

- Maintainer: Gazi Enes Sedef. Publisher: Lorewound. Private security reports: support@lorewound.com; see [SECURITY.md](SECURITY.md).
- Keep secret values in ignored local configuration or the hosting provider's secret store. This document records names only.
- Changing a local environment file does not revoke a provider credential. If exposed, revoke/rotate through the provider, update authorized consumers and verify the old credential is unusable without logging it.
- Tests that send messages, delete records, publish assets or spend provider credits require deliberate authorization and disposable data. No such actions were performed for this review.
- Keep this map aligned with source changes; use [README.md](README.md) for setup and [MAINTENANCE.md](MAINTENANCE.md) for routine checks.

