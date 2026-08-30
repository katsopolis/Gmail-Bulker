# Gmail Bulker Maintenance Guide

## Ownership

- Creator and producer: Gazi Enes Sedef
- Publisher: Lorewound
- Contact: support@lorewound.com

## Supported Surface

- Target platforms: Chrome desktop
- Primary technology: See project source and manifests

## Routine Maintenance

1. Start from a clean working tree and review dependency release notes before major upgrades.
2. Install dependencies from the committed lockfile where available.
3. Run the project's available checks before merging:

```text
Review the project-specific detailed documentation below
```

4. Confirm that no local agent state, generated output, credentials, or machine-specific files are tracked.
5. Smoke-test every platform affected by the change.
6. Update README.md when commands, platform support, or product behavior changes.

## Security

- Keep secrets in ignored local environment files and production secret managers.
- Never use browser-exposed environment prefixes for private credentials.
- Rotate a credential immediately if it reaches source control, logs, screenshots, or generated agent artifacts.
- Review production dependency advisories before a release; test major upgrades separately.

## Release Checklist

- [ ] Working tree reviewed
- [ ] Dependency lockfiles intentional
- [ ] Lint/type/build/test checks completed where available
- [ ] Platform smoke tests completed
- [ ] No secrets or local agent state tracked
- [ ] README and legal links remain accurate

## Legal and Attribution

- Current original project material is proprietary and all rights are reserved by Gazi Enes Sedef, published by Lorewound.
- No use, execution, copying, modification, distribution, hosting, or commercial exploitation is permitted without prior written permission.
- General portfolio legal documents live at https://github.com/katsopolis/Legal-Docs.
- Project-specific third-party notices, upstream attribution, historical grants, and asset licenses must remain intact.
