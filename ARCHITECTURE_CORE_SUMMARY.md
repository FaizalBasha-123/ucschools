# Architecture Core Summary

Date: 2026-04-13

This file consolidates architecture/core-idea documents into one reference.

## Source Files Consolidated
- AI-Tutor-Backend/BILLING_ARCHITECTURE.md
- AI-Tutor-Backend/BILLING_ARCHITECTURE_DIAGRAMS.md
- AI-Tutor-Backend/BILLING_DESIGN_REASONING.md
- AI-Tutor-Backend/BILLING_IMPLEMENTATION_SUMMARY.md

## Core Design Principles
- Invoice is the financial source of truth.
- Payment, invoice state transition, and credit grant must be tightly coupled and auditable.
- Idempotency is mandatory for payment attempts and webhook handling.
- Dunning and grace period behavior must be explicit and state-driven.
- Entitlement checks must derive from effective state, not isolated flags.

## Canonical Financial Entities
- Invoice: immutable after finalization; status drives account financial truth.
- InvoiceLine: itemized charges/credits including prorations and adjustments.
- PaymentIntent: attempt-level record with deterministic idempotency key pattern.
- DunningCase: retry schedule and grace lifecycle ownership.
- CreditTransaction: authoritative ledger mutation linked to invoice/payment context.

## Canonical State Flows

### Success Path
1. Draft invoice is created.
2. Invoice lines are added and validated.
3. Invoice is finalized (locked).
4. Payment intent is created and captured with idempotency key.
5. In one atomic transaction:
   - payment intent captured
   - invoice marked paid
   - credit grant posted

### Failure and Recovery Path
1. Capture fails and payment intent is marked failed.
2. Dunning case starts with retry schedule.
3. Grace period keeps account behavior explicit.
4. Retry success moves to recovered and completes success path.
5. Exhausted retries move toward overdue/uncollectible and entitlement restriction.

## Safety Invariants
- Every paid invoice must have a corresponding credit grant record.
- Same payment idempotency key must never produce duplicate capture side effects.
- Same webhook event id must never execute business side effects twice.
- Proration and adjustment lines must remain explicit and auditable.

## Operational Architecture Requirements
- Startup readiness checks must gate service startup when critical dependencies are invalid.
- Financial and entitlement transitions must emit clear audit/trace signals.
- Recovery operations must preserve correctness before availability shortcuts.

## Implementation Guidance Snapshot
- Prefer transaction-scoped state transitions for financial operations.
- Keep domain and storage contracts explicit for invoice, payment, dunning, ledger.
- Keep entitlement computation centralized and reused in protected runtime routes.
