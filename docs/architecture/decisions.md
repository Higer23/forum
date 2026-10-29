# Higum Forum — Architecture Decisions

Status: proposed baseline for staged implementation  
Project repository: https://github.com/Higer23/forum  
Product name: Higum

## Context

The existing repository is a static browser application using Firebase Authentication and Firebase Realtime Database. This record is based on the current repository contents, not on a production security audit. No production configuration, Firebase rules, or live registration flow has been verified in this stage.

## Decisions

### ADR-001 — Preserve the existing project and data model for now

- Continue in the existing `Higer23/forum` repository; do not create a new repository.
- Keep the current static frontend and Firebase Authentication/Realtime Database as the starting point.
- Avoid a backend rewrite or data migration until the existing flows and database rules have been inspected and tested.
- Treat the repository name `forum` as an implementation detail; the product name remains **Higum**.

### ADR-002 — Enforce school-domain eligibility on the trusted side

- Registration eligibility is limited to addresses whose normalized domain is exactly `domgymnasium-verden.de`; reject lookalike domains and subdomains unless a later explicit policy says otherwise.
- A frontend-only domain check is not a security control.
- Data access rules must require an authenticated account with a verified email, and the trusted registration flow must verify the domain before granting forum access.
- Never place service-account credentials, email API keys, or other server secrets in browser files or public repository content.

### ADR-003 — Verification-code workflow requires a trusted backend

- The intended flow is: submit school email → send a short-lived one-time code → verify the code server-side → allow the user to choose a unique nickname.
- Generate and verify codes on the server; store only a hash of each code where practical; expire codes; limit attempts and resend frequency; avoid revealing whether an address already has an account.
- A successful code must be single-use. Do not grant access based solely on a client-side success flag.
- The backend technology and integration with Firebase must be validated before implementation. A Cloudflare Worker with free-tier limits is a candidate, not yet deployed or tested.

### ADR-004 — Nickname uniqueness must be atomic

- Usernames/nicknames are separate concepts: the system-generated account username is deterministic from a safe, normalized part of the verified email or a stable random suffix; the public nickname is chosen by the user.
- The final username-generation policy must not expose the full school email address.
- Enforce nickname uniqueness in a trusted backend using an atomic reservation/transaction. A browser-side availability check alone is insufficient.
- Normalize nicknames consistently and define allowed characters, length, case sensitivity, and reserved words before implementation.

### ADR-005 — Email delivery provider remains undecided

- Do not select or integrate an email provider in this stage.
- Compare free-tier limits, daily caps, external-recipient delivery, domain verification, abuse protections, privacy/data retention, and account requirements in stages 31–32.
- Do not enable paid plans, paid overages, or billing without explicit user approval.
- Password-recovery email delivery must use the same reviewed provider decision, unless a later documented reason requires otherwise.

### ADR-006 — Security and reliability gates

- Inspect and test Firebase Realtime Database rules before enabling public registration or posting.
- Add server-side rate limits, request-size validation, input validation, generic authentication errors, and audit-safe logs that exclude passwords, codes, tokens, and email contents.
- Never log passwords, verification codes, reset links, access tokens, or service-account credentials.
- Keep secrets in provider-managed secret storage; commit only placeholder names in `.env.example`.
- Add automated tests for domain validation, code expiry/replay, attempt limits, nickname race conditions, unverified-user access, and recovery flow.
- Do not claim the forum is secure or production-ready until these tests and a manual end-to-end test pass.

## Open questions for later stages

1. Inspect the current registration/login code and existing Firebase Realtime Database rules (if any).
2. Decide the exact auto-generated username format and nickname policy.
3. Evaluate email providers in stages 31–32; no provider is approved yet.
4. Confirm free-tier capacity and account limits before deployment.
5. Define backup/export and rollback procedures before any database or production configuration change.

## Stage boundary

This document is an architecture proposal only. It does not change application behavior, Firebase settings, Cloudflare settings, DNS, email delivery, or production data.
