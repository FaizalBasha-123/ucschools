/**
 * Web Search Integration
 *
 * Proxies search requests to the Rust backend to keep the API keys secure.
 */

import { proxyFetch } from '@/lib/server/proxy-fetch';
import type { WebSearchResult, WebSearchSource } from '@/lib/types/web-search';

/**
 * Search the web by proxying the request to our secure Rust backend.
 */
export async function searchWithTavily(params: {
  query: string;
  pdfText?: string;
  apiKey?: string; // Kept for signature compatibility, but ignored
  maxResults?: number;
}): Promise<WebSearchResult> {
  const { query, pdfText } = params;

  const backendUrl =
    process.env.NEXT_PUBLIC_AI_TUTOR_API_BASE_URL ||
    process.env.AI_TUTOR_API_BASE_URL ||
    'http://127.0.0.1:8099';

  const res = await proxyFetch(`${backendUrl}/api/tools/web-search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      pdfText,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => '');
    throw new Error(`Backend search error (${res.status}): ${errorText || res.statusText}`);
  }

  const data = (await res.json()) as WebSearchResult;

  return data;
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
