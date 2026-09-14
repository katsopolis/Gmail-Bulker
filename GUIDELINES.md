# Gmail Bulker Guidelines

## Purpose and scope

These rules govern the browser extension UI, Gmail API integration, message batching and OAuth configuration. They complement the root `README.md`, `SERVICES.md` and `SECURITY.md`. Product-specific behavior and established design tokens take priority over generic examples.

## Architecture and ownership

- Use least-privilege extension permissions and keep Gmail operations behind explicit user actions. OAuth client identifiers may be public, but secrets and reusable tokens never belong in source.
- Keep public interfaces typed and small. Validate data at trust boundaries and document compatibility changes.
- Avoid parallel implementations of the same rule. One module owns each invariant, transformation and persistence decision.
- Generated files and build artifacts are not edited by hand or committed unless the project explicitly treats them as source.

## Product and visual system

- Preserve the compact extension layout and existing icon system. Batch scope, account identity and destructive consequences must be visible before execution.
- Reuse existing spacing, radii, typography, color and motion tokens. A new token needs a clear reusable purpose.
- Prefer real icons from the established library or authored asset set. Emoji and platform-dependent glyphs are not interface icons.
- Text must wrap, truncate or scale by a documented rule; it may not overflow controls or hide essential meaning.
- Reduced-motion, visible focus, semantic labels and sufficient contrast are required wherever the platform supports them.

## Layout and interaction

- Popup and options pages need keyboard access, visible focus and readable wrapping at constrained extension widths. Primary actions use at least 44 px target height.
- Every interactive state works without hover. Disabled controls remain legible and explain prerequisites when ambiguity would block the user.
- Reserve layout for asynchronous content to prevent jumps. Use a stable skeleton, progress indicator or concise status only when work is actually pending.
- Empty and error states provide the next valid action. Destructive or irreversible actions require clear scope and confirmation.

## State, data and failure handling

- Queued, sending, rate-limited, partially completed, cancelled and failed states must be distinct. Retrying must not duplicate already confirmed sends.
- Persist only the minimum required data. Version stored formats and provide migration or safe-reset behavior when compatibility changes.
- Never replace an unknown or failed state with a plausible zero, success message or silent fallback.
- Logs must be useful for diagnosis without including secrets, access tokens, personal content or unnecessary identifiers.

## Security and dependencies

- Follow `SECURITY.md`. Keep secrets in ignored environment files, OS/application secret storage or the deployment provider; never embed them in client artifacts.
- Apply least privilege to filesystem, network, database, extension, plugin and store permissions.
- Pin lockfiles and runtime/toolchain versions where the repository already supports them. Update dependencies in reviewed batches and read migration notes before major upgrades.
- Preserve third-party licenses and provenance for code, fonts, art, audio and models.

## Performance and resilience

- Process in bounded batches, respect provider quotas and avoid keeping background workers awake without work.
- Measure before introducing complex caching. Every cache needs a key, owner, lifetime and invalidation rule.
- Network features need timeouts, bounded retries and cancellation. Offline or degraded behavior must be explicit rather than accidental.
- Animation must not block input; prefer transform and opacity for interface motion when applicable.

## Verification and release

- Validate the manifest, lint/build if configured and test with a non-production account. Permission or batching changes require quota/error-path tests.
- Review at least one small, one representative and one large/edge-case input or viewport for affected behavior.
- A passing build is not proof of runtime correctness. Test the packaged or exported artifact when platform boundaries change.
- Store submission requires OAuth/referrer/API restriction review, privacy disclosure, permission justification and manual verification of the packaged extension.
- Record remaining release gates as release requirements, not as active defects, until a release decision makes them actionable.

## Documentation maintenance

Update this file when architecture, platform targets, visual tokens, permissions, service boundaries or release commands change. Keep `README.md` focused on product understanding and setup; keep provider/runtime details in `SERVICES.md`.
