/**
 * Web Search Integration — Tavily
 *
 * Calls the Tavily Search API directly. API key is resolved server-side
 * from the AI_TUTOR_TAVILY_API_KEY environment variable or server-providers.yml.
 */

import { resolveWebSearchApiKey } from '@/lib/server/provider-config';
import type { WebSearchResult, WebSearchSource } from '@/lib/types/web-search';

const TAVILY_API_URL = 'https://api.tavily.com/search';

/**
 * Search the web using Tavily. API key is resolved server-side — never
 * passed from the client.
 */
export async function searchWithTavily(params: {
  query: string;
  pdfText?: string;
  apiKey?: string;
  maxResults?: number;
}): Promise<WebSearchResult> {
  const { query, apiKey: clientKey, maxResults = 5 } = params;

  const apiKey = resolveWebSearchApiKey(clientKey);
  if (!apiKey) {
    throw new Error(
      'No Tavily API key configured. Set AI_TUTOR_TAVILY_API_KEY in environment or server-providers.yml.',
    );
  }

  const res = await fetch(TAVILY_API_URL, {
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
      max_results: maxResults,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Tavily search error (${res.status}): ${errorText || res.statusText}`);
  }

  const raw = await res.json();

  return {
    answer: raw.answer || '',
    query: raw.query || query,
    responseTime: raw.response_time || 0,
    sources: (raw.results || []).map(
      (r: { title: string; url: string; content: string; score: number }): WebSearchSource => ({
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
        score: r.score || 0,
      }),
    ),
  };
}

/**
 * Format search results into a markdown context block for LLM prompts.
 */
export function formatSearchResultsAsContext(result: WebSearchResult): string {
  if (!result.answer && (!result.sources || result.sources.length === 0)) {
    return '';
  }

  const lines: string[] = [];

  if (result.answer) {
    lines.push(result.answer);
    lines.push('');
  }

  if (result.sources && result.sources.length > 0) {
    lines.push('Sources:');
    for (const src of result.sources) {
      lines.push(`- [${src.title}](${src.url}): ${src.content?.slice(0, 200)}`);
    }
  }

  return lines.join('\n');
}
