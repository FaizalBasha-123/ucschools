import { PageSummary } from './plugin';

export interface RelevanceResult {
  page: number;
  score: number;
}

export interface RelevanceScorer {
  readonly id: string;
  score(query: string, summary: PageSummary): number;
}

export class KeywordOverlapScorer implements RelevanceScorer {
  readonly id = 'keyword-overlap';

  score(query: string, summary: PageSummary): number {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) return 0;

    let score = 0;

    for (const token of queryTokens) {
      for (const kw of summary.keywords) {
        if (kw.includes(token) || token.includes(kw)) {
          score += 2;
        }
      }

      if (summary.shortSummary.toLowerCase().includes(token)) {
        score += 1;
      }

      if (summary.sectionHeading?.toLowerCase().includes(token)) {
        score += 3;
      }
    }

    return score;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2);
  }
}

export class SemanticRouter {
  private scorer: RelevanceScorer;

  constructor(scorer?: RelevanceScorer) {
    this.scorer = scorer ?? new KeywordOverlapScorer();
  }

  setScorer(scorer: RelevanceScorer): void {
    this.scorer = scorer;
  }

  getScorerId(): string {
    return this.scorer.id;
  }

  findRelevantPages(query: string, summaries: PageSummary[]): RelevanceResult[] {
    if (!query || summaries.length === 0) return [];

    const scored = summaries
      .map((s) => ({
        page: s.page,
        score: this.scorer.score(query, s),
      }))
      .filter((s) => s.score > 0);

    return scored.sort((a, b) => b.score - a.score);
  }

  formatContext(summaries: PageSummary[], relevant: RelevanceResult[]): string {
    const lines: string[] = ['Page Index:'];

    for (const s of summaries) {
      const kw = s.keywords.length > 0 ? `keywords: [${s.keywords.join(', ')}]` : '';
      const heading = s.sectionHeading ? ` — "${s.sectionHeading}"` : '';
      lines.push(`  Page ${s.page}${heading}${kw ? `, ${kw}` : ''}`);
    }

    if (relevant.length > 0) {
      lines.push('');
      lines.push('Most relevant to current topic:');
      for (const r of relevant.slice(0, 5)) {
        const summary = summaries.find((s) => s.page === r.page);
        const hint = summary?.shortSummary
          ? ` — ${summary.shortSummary.substring(0, 80)}`
          : '';
        lines.push(`  → Page ${r.page} (score: ${r.score})${hint}`);
      }
    }

    return lines.join('\n');
  }
}
