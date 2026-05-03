import { type NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { authHeadersFrom } from '@/lib/server/auth';
import { backendUrl } from '@/lib/server/backend-url';

const log = createLogger('AdminApiCostsProxy');


export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const targetUrl = `${backendUrl()}/api/admin/api-costs${url.search}`;
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: authHeadersFrom(request),
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text();
      log.error(`api-costs backend [${res.status}]: ${text}`);
      // Return empty-but-valid shape so the UI can still render
      if (res.status === 404) {
        return apiSuccess({
          total_cost_usd_30d: 0, openrouter_cost_usd: 0, groq_cost_usd: 0,
          tts_cost_usd: 0, estimated_margin_30d: 0,
          by_component: [], per_user: [],
        });
      }
      return apiError('INTERNAL_ERROR', res.status, 'Failed to load API costs', text);
    }

    const payload = await res.json();
    return apiSuccess(payload);
  } catch (err) {
    log.error('api-costs proxy failed:', err);
    // Graceful degradation — return zero data so the UI doesn't break
    return apiSuccess({
      total_cost_usd_30d: 0, openrouter_cost_usd: 0, groq_cost_usd: 0,
      tts_cost_usd: 0, estimated_margin_30d: 0,
      by_component: [], per_user: [],
    });
  }
}
