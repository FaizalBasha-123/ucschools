import { ExtractedPage, PageSummary } from './plugin';
import { MAX_KEYWORDS_PER_PAGE, MAX_SUMMARY_CHARS } from '@/lib/constants/generation';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'by', 'with', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
  'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your',
  'his', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
  'not', 'no', 'nor', 'none', 'nothing', 'neither', 'but', 'if', 'because',
  'so', 'than', 'too', 'very', 'just', 'about', 'above', 'after', 'again',
  'all', 'also', 'any', 'each', 'every', 'few', 'more', 'most', 'much',
  'many', 'some', 'such', 'only', 'own', 'same', 'into', 'over', 'under',
  'up', 'down', 'out', 'off', 'then', 'once', 'here', 'there', 'when',
  'where', 'why', 'how', 'which', 'who', 'whom', 'what', 'both', 'between',
  'through', 'during', 'before', 'after', 'above', 'below', 'between',
  'since', 'until', 'upon', 'within', 'without', 'along', 'among',
  'around', 'behind', 'beyond', 'inside', 'outside', 'about',
  'across', 'against', 'along', 'among', 'around', 'beside',
  'beyond', 'despite', 'except', 'inside', 'outside',
  'throughout', 'toward', 'underneath', 'until', 'upon',
  'well', 'back', 'still', 'already', 'yet', 'even', 'ever', 'never',
  'always', 'often', 'usually', 'sometimes', 'generally',
  'however', 'therefore', 'nevertheless', 'furthermore',
  'moreover', 'meanwhile', 'otherwise', 'nonetheless',
]);

export function generatePageSummaries(pages: ExtractedPage[]): PageSummary[] {
  return pages.map((page) => ({
    page: page.page,
    keywords: extractKeywords(page.text),
    shortSummary: generateShortSummary(page.text),
    sectionHeading: extractSectionHeading(page.text),
  }));
}

export function extractKeywords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t) && /^[a-zA-Z]/.test(t));

  const freq = new Map<string, number>();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_KEYWORDS_PER_PAGE)
    .map(([word]) => word);
}

export function generateShortSummary(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= MAX_SUMMARY_CHARS) return cleaned;
  return cleaned.substring(0, MAX_SUMMARY_CHARS).replace(/\s+\S*$/, '') + '...';
}

export function extractSectionHeading(text: string): string | undefined {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return undefined;

  const firstLine = lines[0];
  if (
    firstLine.length > 0 &&
    firstLine.length < 100 &&
    !firstLine.endsWith('.') &&
    /^[A-Z]/.test(firstLine)
  ) {
    return firstLine;
  }

  for (const line of lines.slice(0, 5)) {
    if (
      line.length > 0 &&
      line.length < 100 &&
      !line.endsWith('.') &&
      /^[A-Z]/.test(line) &&
      !STOP_WORDS.has(line.split(' ')[0]?.toLowerCase() ?? '')
    ) {
      return line;
    }
  }

  return undefined;
}
