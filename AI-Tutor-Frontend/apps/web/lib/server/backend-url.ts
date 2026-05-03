/**
 * Centralized backend URL resolver for all server-side API route handlers.
 *
 * Resolution order:
 *  1. NEXT_PUBLIC_AI_TUTOR_API_BASE_URL  (also available on the client)
 *  2. AI_TUTOR_API_BASE_URL              (server-only secret)
 *  3. http://127.0.0.1:8099              (local dev fallback)
 *
 * Usage:
 *   import { backendUrl } from '@/lib/server/backend-url';
 *   const res = await fetch(`${backendUrl()}/api/billing/catalog`);
 */
export function backendUrl(): string {
  return (
    process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL ||
    process.env.AI_TUTOR_API_BASE_URL ||
    'http://127.0.0.1:8099'
  );
}
