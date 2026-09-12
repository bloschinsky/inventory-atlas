# Security Policy

## Project status

Inventory Atlas is under active development. There is no supported production release before `1.0.0`; security fixes may still be issued for the latest Usable Validation Release and development line when practical.

## Reporting a vulnerability

Do not report vulnerabilities that expose private inventory data, credentials, tokens, filesystem paths, or deployment details in a public issue.

Use GitHub private vulnerability reporting when it is enabled. Otherwise contact the project owner through an existing private channel and include:

- A concise description and affected version/commit.
- Reproduction steps or a minimal proof of concept.
- Security and privacy impact.
- Any known workaround.
- Whether the report or exploit details have been shared elsewhere.

Do not access data that is not yours, disrupt a live installation, persist after demonstrating the issue, or publish exploit details before a fix is available.

## Security-sensitive areas

Pay particular attention to:

- Authentication, session, invitation, CSRF, and role enforcement.
- Public/authenticated/private/unlisted visibility and inference resistance.
- Scan-token derivation, hashing, revocation, and key rotation.
- File upload, HEIC decoding, media paths, and resource limits.
- Import archive parsing, checksums, path traversal, cycles, references, and size limits.
- SQL ownership, transaction boundaries, idempotency, and outbox behavior.
- Backup artifacts, secrets, provider credentials, and logs.

## Disclosure and fixes

The project owner will validate the report, determine affected versions, coordinate remediation, and decide disclosure timing. A security fix must include regression tests and must not silently weaken an approved security or privacy requirement.
