# Gmail Bulker Security Policy

## Scope

Security reports are handled by Gazi Enes Sedef, publisher Lorewound. Original project material is proprietary; see LICENSE for scope and third-party exceptions. Repository visibility is a separate setting, not established by this policy. No public bug bounty is currently offered. This is a reporting and maintenance policy, not a security certification or a statement that legal notification duties do not apply.

## Reporting a Vulnerability

- Email: support@lorewound.com
- Include: affected component/file, reproduction steps, impact, and any relevant logs (redact secrets before sending).
- Do not open a public GitHub issue for a security finding.
- Expect an acknowledgment within a reasonable time; there is no fixed SLA for a single-maintainer private project.

## Supported Versions

Development fixes target the current `main` branch. Reports about distributed builds are also accepted: include app version, build number, platform and installation source. Do not assume the checkout equals the store release. No LTS or fixed support lifetime is promised unless a release-specific policy explicitly states it.

## Handling Secrets

- Secrets belong in ignored local environment files or a production secret manager — never in tracked source, README examples, or committed screenshots/artifacts.
- If a real credential reaches source control, git history, logs, or a generated agent artifact, treat it as compromised: rotate/revoke it immediately, then clean the tracked file and, if needed, the git history.
- Client-exposed build variables (e.g. `VITE_*`, `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`) are public by construction — never place a private key or secret behind one of these prefixes.

## Dependency Advisories

- Dependabot configuration is in `.github/dependabot.yml`; it covers only listed ecosystems and directories. Confirm actual runs and review remaining native/system dependencies separately. A config file does not prove monitoring is active.
- Review production-path critical/high advisories before a release; do not apply major-version dependency bumps without testing.

## Related

- Maintenance procedures: see `MAINTENANCE.md` in this repository.
- Portfolio-wide legal and licensing documents: https://github.com/katsopolis/Legal-Docs
