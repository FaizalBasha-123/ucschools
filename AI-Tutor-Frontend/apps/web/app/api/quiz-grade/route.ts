/**
 * Quiz Grading API
 *
 * POST: Receives a text question + user answer, calls LLM for scoring and feedback.
 * Used for short-answer (text) questions that cannot be graded locally.
 */

import { NextRequest } from 'next/server';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { proxyGenerateText, buildProxyParams } from '@/lib/server/llm-proxy-client';
const log = createLogger('Quiz Grade');

interface GradeRequest {
  question: string;
  userAnswer: string;
  points: number;
  commentPrompt?: string;
  language?: string;
}

interface GradeResponse {
  score: number;
  comment: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: GradeRequest = await req.json();
    const { question, userAnswer, points, commentPrompt } = body;

    if (!question) {
      return apiError('INVALID_REQUEST', 400, 'question is required');
    }
    if (!userAnswer) {
      return apiError('INVALID_REQUEST', 400, 'userAnswer is required');
    }
    if (!points || points < 1) {
      return apiError('INVALID_REQUEST', 400, 'points must be a positive number');
    }

    const qualityMode = req.headers.get('x-quality-mode') || 'standard';
    const learningMode = req.headers.get('x-learning-mode') || 'explain';

    const systemPrompt = `You are a professional educational assessor. Grade the student's answer and provide brief feedback.
You must reply in the following JSON format only (no other content):
{"score": <integer from 0 to ${points}>, "comment": "<one or two sentences of feedback>"}`;

    const userPrompt = `Question: ${question}
Full marks: ${points} points
${commentPrompt ? `Grading guidance: ${commentPrompt}\n` : ''}Student answer: ${userAnswer}`;

    const result = await proxyGenerateText(
      buildProxyParams('quiz-grade', systemPrompt, userPrompt, {
        qualityMode,
        learningMode,
      }),
    );

    const text = result.text.trim();

    let gradeResult: GradeResponse;

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      gradeResult = JSON.parse(jsonMatch[0]);
    } catch {
      log.warn(`Failed to parse grade response as JSON, text="${text}"`);
      return apiError('PARSE_FAILED', 500, 'Failed to parse LLM response as JSON');
    }

    if (typeof gradeResult.score !== 'number' || typeof gradeResult.comment !== 'string') {
      return apiError('PARSE_FAILED', 500, 'Invalid grade response format');
    }

    gradeResult.score = Math.max(0, Math.min(points, gradeResult.score));

    return apiSuccess(gradeResult as unknown as Record<string, unknown>);
  } catch (error) {
    log.error('Quiz grade failed:', error);
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
