/**
 * PDF Parsing API
 *
 * POST /api/parse-pdf
 *
 * Receives a multipart/form-data upload with a PDF file.
 * Sends the PDF to Gemini 2.0 Flash (via OpenRouter) as a base64-encoded
 * file part and extracts text + image descriptions.
 *
 * API key resolution order:
 *  1. Client-supplied `apiKey` form field (user's own key from settings UI)
 *  2. PDF_OPENROUTER_API_KEY env var (server-side)
 *  3. server-providers.yml → pdf.gemini-openrouter.apiKey
 */

import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { resolvePDFApiKey, resolvePDFBaseUrl } from '@/lib/server/provider-config';

const log = createLogger('Parse PDF');

export const maxDuration = 120;

const DEFAULT_MODEL = 'google/gemini-2.0-flash-001';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

const EXTRACT_PROMPT = `You are a document parser. Extract all text content from this PDF document.

Return a JSON object with this exact structure:
{
  "text": "<full extracted text from all pages, preserving paragraphs and structure>",
  "pageCount": <number of pages>,
  "images": []
}

Rules:
- Extract ALL text verbatim, preserving paragraph breaks.
- Do NOT summarize or paraphrase — extract the actual text.
- Set images to an empty array (images are handled separately).
- Return ONLY valid JSON. No markdown fences, no explanation.`;

export async function POST(req: NextRequest) {
  let pdfFileName: string | undefined;
  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return apiError(
        'INVALID_REQUEST',
        400,
        `Invalid Content-Type: expected multipart/form-data, got "${contentType}"`,
      );
    }

    const formData = await req.formData();
    const pdfFile = formData.get('pdf') as File | null;

    if (!pdfFile) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'No PDF file provided');
    }

    pdfFileName = pdfFile.name;

    // Resolve provider config
    const providerId = (formData.get('providerId') as string | null) || 'gemini-openrouter';
    const clientKey = (formData.get('apiKey') as string | null) || undefined;
    const clientBaseUrl = (formData.get('baseUrl') as string | null) || undefined;

    const apiKey = resolvePDFApiKey(providerId, clientKey);
    if (!apiKey) {
      log.warn('No PDF API key configured — PDF parsing unavailable');
      return apiError(
        'MISSING_API_KEY',
        401,
        'PDF parsing is not configured. Set PDF_OPENROUTER_API_KEY in environment.',
      );
    }

    const baseUrl = resolvePDFBaseUrl(providerId, clientBaseUrl) || DEFAULT_BASE_URL;
    const model = process.env.PDF_OPENROUTER_MODEL || DEFAULT_MODEL;

    // Convert PDF to base64
    const pdfBuffer = await pdfFile.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

    log.info(
      `Parsing PDF: "${pdfFileName}" (${Math.round(pdfBuffer.byteLength / 1024)}KB) via ${providerId}`,
    );

    // Call Gemini via OpenRouter with the PDF as a file part
    const openRouterRes = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://uc-aitutor.vercel.app',
        'X-Title': 'UC AI Tutor',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: EXTRACT_PROMPT,
              },
              {
                type: 'file',
                file: {
                  filename: pdfFileName,
                  file_data: `data:application/pdf;base64,${pdfBase64}`,
                },
              },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 16000,
      }),
    });

    if (!openRouterRes.ok) {
      const errorText = await openRouterRes.text().catch(() => '');
      log.error(`OpenRouter PDF parsing failed: ${openRouterRes.status} ${errorText}`);
      return apiError(
        'UPSTREAM_ERROR',
        openRouterRes.status,
        'PDF parsing provider returned an error',
        errorText,
      );
    }

    const openRouterData = await openRouterRes.json();
    const rawText: string = openRouterData.choices?.[0]?.message?.content || '';

    if (!rawText) {
      log.error('Empty response from PDF parser');
      return apiError('PARSE_FAILED', 500, 'PDF parser returned an empty response');
    }

    // Parse the JSON response from the LLM
    let parsed: { text: string; pageCount?: number; images?: string[] };
    try {
      // Strip any accidental markdown fences
      const cleaned = rawText.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      parsed = JSON.parse(cleaned);
    } catch {
      // If JSON parsing fails, treat the entire response as plain text
      log.warn('PDF parser returned non-JSON, treating as plain text');
      parsed = { text: rawText, images: [] };
    }

    if (!parsed.text) {
      return apiError('PARSE_FAILED', 500, 'PDF parser could not extract any text');
    }

    log.info(
      `PDF parsed: "${pdfFileName}" → ${parsed.text.length} chars, ${parsed.images?.length ?? 0} images`,
    );

    return apiSuccess({
      data: {
        text: parsed.text,
        images: parsed.images || [],
        metadata: {
          pageCount: parsed.pageCount || 1,
          parser: model,
          pdfImages: [], // vision-based image extraction not yet supported via base64 upload
        },
      },
    });
  } catch (error) {
    log.error(`PDF parsing failed [file="${pdfFileName ?? 'unknown'}"]`, error);
    return apiError('PARSE_FAILED', 500, error instanceof Error ? error.message : 'Unknown error');
  }
}
