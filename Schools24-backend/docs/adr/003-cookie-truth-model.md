# ADR-003: Cookie Truth Model (App vs Landing)

**Status:** Accepted  
**Date:** 2026-03-18  
**Decision-makers:** Schools24 Platform Engineering + Legal  

## Context

Schools24 operates two web properties:
1. **App** (`Schools24-frontend`): Next.js dashboard for students, teachers, admins
2. **Landing** (`schools24-landing`): Vite/React marketing + public site

Each has independent cookie consent implementation. This ADR documents the current
runtime behavior and identifies a legal/truthfulness mismatch.

## Current State

### App (`Schools24-frontend/src/components/CookieConsent.tsx`)

| Aspect | Value |
|--------|-------|
| Storage key | `schools24_cookie_preferences` |
| Fields | `essential` (always true), `analytics`, `marketing`, `acceptedAt` |
| Banner text | "We Use Essential Cookies" / "Schools24 uses only 3 essential cookies" |
| Toggles shown | Essential (locked), Analytics (toggle), Marketing (toggle) |
| GA integration | **None** — no Google Analytics script loaded anywhere in the app |
| Actual cookies | `School24_api_token`, `School24_api_refresh`, `School24_csrf` |

### Landing (`schools24-landing`)

| Aspect | Value |
|--------|-------|
| Storage key | `schools24_cookie_consent_v1` |
| Fields | `essential` (always true), `analytics`, `updatedAt`, `policyVersion` |
| Banner text | "Cookies and Tracking Choices" / "Analytics is optional and is disabled until you opt in" |
| GA integration | **Consent-gated** — GA (`G-4GEYNE69TR`) only loads after explicit opt-in |
| `index.html` | No pre-consent `<script>` for GA (comment says "loaded only after explicit consent") |
| Consent mode | Uses Google Consent Mode v2 (`gtag('consent', 'default', ...)`) |

## Mismatch Analysis

| Issue | Severity | Details |
|-------|----------|---------|
| **App banner says "essential only" but shows analytics/marketing toggles** | 🔴 High | Legal mismatch: UI implies optional cookies exist, but no analytics runs. Confusing for users and auditors. |
| **Different storage keys** | 🟡 Medium | App and landing don't share consent decisions. User must consent separately on each property. |
| **App stores `marketing` field** | 🟡 Medium | No marketing cookies exist in the app. Dead config that could mislead auditors. |
| **App lacks `policyVersion`** | 🟡 Medium | Landing tracks policy version; app does not. Inconsistent for re-consent flows. |

## Decision

**Mode A: Essential-only for App.** The app has zero analytics/marketing scripts. The consent
banner must truthfully reflect this:

1. Remove analytics and marketing toggles from `CookieConsent.tsx`.
2. Update banner to state only essential cookies are used.
3. Add `policyVersion` to stored preferences for future re-consent support.
4. Landing keeps its current consent-gated GA model (already correct).
5. Optionally unify storage key, or document the divergence.

This will be implemented in **PR-07**.

## Consequences

- App cookie banner becomes simpler and legally accurate.
- If GA is later added to the app, a new PR must add consent-gated loading (following landing's pattern).
- Landing's `cookieConsent.ts` remains the reference implementation for consent-gated analytics.
- Policy page content in both app and landing must be updated to match actual behavior.
