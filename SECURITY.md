# Security Policy

## Supported branch

Security fixes are accepted on `main`.

## Reporting a vulnerability

Please open a private security advisory in GitHub Security tab for this repository.

## Current security posture

- Filesystem operations are constrained to a configured workspace root.
- Canonical path checks are used to prevent directory traversal/escape.
- Game process execution is explicit and user-driven.
- No bundled secrets or credential defaults are shipped.

## Contributor security checklist

- Do not hardcode executable paths, API keys, or tokens.
- Keep command execution scope explicit and minimal.
- Validate all path handling against workspace boundaries.
- Ensure AI-generated changes remain reviewable before application.
