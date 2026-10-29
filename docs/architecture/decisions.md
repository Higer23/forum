# Higum Forum — Architecture Decisions

**Status:** Stage 2 draft; documentation only.  
**Scope:** Existing repository `Higer23/forum` (the repository README identifies the app as Higum Forum).  
**Last reviewed:** 2026-10-29  
**Budget constraint:** €0. Do not enable paid plans or paid overages.

## 1. Current state (verified from the repository)

- The app is a static browser application: `index.html`, `styles.css`, `app.js`, `topic.html`, and `topic.js`.
- `firebase-config.js` initializes Firebase JS SDK 10.8.1 Authentication and Realtime Database.
- The README describes email/password and Google sign-in, email verification, browsing topics, and posting.
- The current UI includes a Cloudflare Turnstile widget.
- There is no `package.json`, `src/` directory, or existing `docs/` directory in the inspected root.
- The repository's default branch is `main`. This document is being added on a separate review branch; `main` has not been changed.

These observations describe the code as found, not a security certification. Firebase client configuration values are not server secrets; access control must be enforced by Firebase security rules and trusted server-side logic.

## 2. Requirements that must be enforced server-side

The intended school-community registration flow requires:

1. Accept only addresses ending in the exact domain `@domgymnasium-verden.de` (case-insensitive comparison of the domain part; reject lookalike domains).
2. Send a short-lived, single-use verification code to that address.
3. Verify the code on a trusted server, not only in browser JavaScript.
4. Generate the account username automatically.
5. Enforce nickname uniqueness atomically in the authoritative database; a browser-side availability check alone is not enough.
6. Provide a secure password-reset flow that does not disclose whether an account exists.
7. Rate-limit code requests and verification attempts, expire codes, invalidate a code after use, and never log codes or passwords.
8. Keep the forum's data protected by database rules even if a user bypasses the UI or calls an API directly.

## 3. Decisions for this stage

### ADR-001 — Preserve the existing project

**Decision:** Continue in the existing `Higer23/forum` repository, whose README names the product “Higum Forum.” Do not create another repository.

**Reason:** A direct lookup of `Higer23/higum` returned 404 and the repository was absent from the accessible repository inventory; `Higer23/forum` is the existing repository whose contents identify it as Higum Forum.

### ADR-002 — Do not implement OTP solely in the browser

**Decision:** A verification code must not be generated, stored, or validated only by client-side JavaScript.

**Reason:** Browser-side logic can be inspected or bypassed. The verification state, expiry, attempt limits, and single-use behaviour must be checked by trusted backend logic.

### ADR-003 — Keep the existing authentication flow unchanged until the identity design is settled

**Decision:** Do not replace Firebase Authentication, change database rules, or introduce a second identity store in this stage.

**Reason:** The current app uses Firebase Authentication and Realtime Database. A custom OTP flow must be designed consistently with account creation, the trusted “email verified” state, session issuance, account recovery, and database authorization. Mixing a custom code with Firebase's existing verification-link flow without a defined trust boundary could create an apparent verification step that does not actually protect the account.

### ADR-004 — Defer transactional email provider selection

**Decision:** No email provider is selected in Stage 2. Compare providers, their free limits, sender/domain requirements, anti-abuse policies, and deliverability in Stages 31–32, as requested. If no suitable provider can meet the €0 constraint, stop and ask before proceeding.

### ADR-005 — No paid infrastructure

**Decision:** Stay on free tiers only. Do not enable paid Workers plans, paid email plans, or automatic paid overages. Any future step that could incur a charge must stop for explicit user approval.

## 4. Architecture direction to evaluate (not yet approved or implemented)

Before coding registration, compare these approaches:

- **Option A — Firebase-first:** retain Firebase Authentication and use its supported email-verification mechanism. Confirm whether the required code-based flow can be achieved safely without a custom identity backend.
- **Option B — Trusted backend verification:** add a server-side verification endpoint and durable storage for hashed, expiring, single-use codes and nickname reservations. Define how verified accounts become trusted Firebase identities before implementation.
- **Option C — Full identity migration:** move authentication and account state to a backend-controlled identity system. This has a larger migration and testing cost and must not be chosen without a concrete free-tier and recovery plan.

No option is approved by this draft. In particular, do not treat a client-side form, Turnstile widget, or successful email send as proof that account verification is secure.

## 5. Required checks before the registration implementation

- Review Firebase Authentication settings and Realtime Database security rules.
- Confirm the intended hosting and deployment workflow.
- Confirm whether the school domain can be verified and whether the school permits this use.
- Design rate limits, code hashing, expiry, resend cooldowns, nickname normalization, and atomic uniqueness enforcement.
- Test sign-up, duplicate nickname races, expired/incorrect/reused codes, password reset, unauthorized database access, and abuse throttling.
- Use synthetic test accounts only; never use real student data during development.

## 6. Known access limitation

The previous Cloudflare inspection could list the account but could not list zones/DNS because the connected token returned HTTP 403. No Cloudflare settings were changed. Re-check permissions only when a later stage actually needs Cloudflare.

## 7. Stage 2 change record

- Added this decision draft on branch `docs/stage-02-architecture-decisions`.
- No application code, Firebase settings, Cloudflare settings, email provider, or production data was changed.
- This draft needs review before any implementation based on the proposed architecture direction.
