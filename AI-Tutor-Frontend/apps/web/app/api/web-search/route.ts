/**
 * Web Search API
 *
 * POST /api/web-search
 * Calls Tavily directly on the server side, keeping the API key secure.
 * Returns { sources, context } for use by the generation-preview pipeline.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError } from '@/lib/server/api-response';
import { resolveWebSearchApiKey } from '@/lib/server/provider-config';
import { formatSearchResultsAsContext } from '@/lib/web-search/tavily';
import type { WebSearchResult } from '@/lib/types/web-search';

const log = createLogger('WebSearch');

const TAVILY_API_URL = 'https://api.tavily.com/search';

export async function POST(req: NextRequest) {
  let query: string | undefined;
  try {
    const body = await req.json();
    query = body.query;

    if (!query || !query.trim()) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'query is required');
    }

    // Resolve API key: client-supplied (user's own key) → server env TAVILY_API_KEY
    const apiKey = resolveWebSearchApiKey(body.apiKey);
    if (!apiKey) {
      log.warn('No Tavily API key configured — web search unavailable');
      return apiError(
        'MISSING_API_KEY',
        401,
        'Web search is not configured. Set TAVILY_API_KEY in environment.',
      );
    }

    // Call Tavily search API directly on the server
    const tavilyRes = await fetch(TAVILY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query: query.trim(),
        search_depth: 'basic',
        include_answer: true,
        include_raw_content: false,
        max_results: 5,
      }),
    });

    if (!tavilyRes.ok) {
      const errorText = await tavilyRes.text().catch(() => '');
      log.error(`Tavily search failed: ${tavilyRes.status} ${errorText}`);
      return apiError(
        'UPSTREAM_ERROR',
        tavilyRes.status,
        'Web search provider returned an error',
        errorText,
      );
    }

    const raw = await tavilyRes.json();

    // Normalise Tavily response → WebSearchResult
    const result: WebSearchResult = {
      answer: raw.answer || '',
      query: raw.query || query,
      responseTime: raw.response_time || 0,
      sources: (raw.results || []).map(
        (r: { title: string; url: string; content: string; score: number }) => ({
          title: r.title || '',
          url: r.url || '',
          content: r.content || '',
          score: r.score || 0,
        }),
      ),
    };

    // Build context string for the LLM
    const context = formatSearchResultsAsContext(result);

    log.info(`Web search: "${query.substring(0, 60)}" → ${result.sources.length} sources`);

    return NextResponse.json({
      sources: result.sources,
      context,
      answer: result.answer,
    });
  } catch (err) {
    log.error(`Web search failed [query="${query?.substring(0, 60) ?? 'unknown'}"]`, err);
    const message = err instanceof Error ? err.message : 'Web search failed';
    return apiError('INTERNAL_ERROR', 500, message);
  }
}
