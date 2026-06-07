'use client';

import { useMemo, useState } from 'react';
import type { InteractiveContent } from '@/lib/types/stage';
import { Info, X, Activity, Variable, FunctionSquare, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InteractiveRendererProps {
  readonly content: InteractiveContent;
  readonly mode: 'autonomous' | 'playback';
  readonly sceneId: string;
}

export function InteractiveRenderer({ content, mode: _mode, sceneId }: InteractiveRendererProps) {
  const [showModel, setShowModel] = useState(false);
  const patchedHtml = useMemo(
    () => (content.html ? patchHtmlForIframe(content.html) : undefined),
    [content.html],
  );

  const hasModel = useMemo(() => {
    const sm = content.scientificModel;
    return !!(
      sm &&
      (sm.variables?.length ||
        sm.core_formulas?.length ||
        sm.mechanism?.length ||
        sm.experiment_steps?.length)
    );
  }, [content.scientificModel]);

  return (
    <div className="w-full h-full relative group">
      <iframe
        srcDoc={patchedHtml}
        src={patchedHtml ? undefined : content.url}
        className="absolute inset-0 w-full h-full border-0"
        title={`Interactive Scene ${sceneId}`}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />

      {hasModel && (
        <>
          <button
            onClick={() => setShowModel(!showModel)}
            className={cn(
              'absolute top-4 right-4 z-10 p-2 rounded-full transition-all duration-200',
              'bg-white/90 dark:bg-gray-800/90 shadow-lg border border-gray-200 dark:border-gray-700',
              'hover:scale-105 active:scale-95 text-teal-600 dark:text-teal-400',
              showModel && 'bg-teal-500 text-white dark:bg-teal-600 dark:text-white border-transparent',
            )}
            title="Scientific Model Details"
          >
            {showModel ? <X className="w-5 h-5" /> : <Info className="w-5 h-5" />}
          </button>

          {showModel && content.scientificModel && (
            <div className="absolute top-16 right-4 bottom-4 w-80 z-20 bg-white/95 dark:bg-gray-900/95 shadow-2xl border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden flex flex-col backdrop-blur-md">
              <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 flex items-center gap-2">
                <Activity className="w-4 h-4 text-teal-500" />
                <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100">
                  Scientific Model
                </h3>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {content.scientificModel.variables?.length > 0 && (
                  <section className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <Variable className="w-3 h-3" />
                      <span>Variables</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {content.scientificModel.variables.map((v, i) => (
                        <span
                          key={i}
                          className="px-2 py-1 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded text-xs border border-teal-100 dark:border-teal-800"
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {content.scientificModel.core_formulas?.length > 0 && (
                  <section className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <FunctionSquare className="w-3 h-3" />
                      <span>Core Formulas</span>
                    </div>
                    <ul className="space-y-2">
                      {content.scientificModel.core_formulas.map((f, i) => (
                        <li
                          key={i}
                          className="p-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-xs font-mono text-gray-700 dark:text-gray-300 border border-gray-100 dark:border-gray-700"
                        >
                          {f}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {content.scientificModel.experiment_steps?.length > 0 && (
                  <section className="space-y-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      <Target className="w-3 h-3" />
                      <span>Suggested Experiments</span>
                    </div>
                    <ul className="space-y-2">
                      {content.scientificModel.experiment_steps.map((s, i) => (
                        <li key={i} className="flex gap-2 text-xs text-gray-600 dark:text-gray-400">
                          <span className="shrink-0 w-4 h-4 rounded-full bg-teal-100 dark:bg-teal-900/50 text-teal-600 flex items-center justify-center font-bold">
                            {i + 1}
                          </span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Patch embedded HTML to display correctly inside an iframe.
 *
 * Fixes:
 * - min-h-screen / h-screen → use 100% of iframe viewport
 * - Ensure html/body fill the iframe with no overflow issues
 * - Canvas elements use container sizing instead of viewport
 */
function patchHtmlForIframe(html: string): string {
  const iframeCss = `<style data-iframe-patch>
  html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }
  /* Fix min-h-screen: in iframes 100vh is the iframe height, which is correct,
     but ensure body actually fills it */
  body { min-height: 100vh; }
</style>`;

  // Insert right after <head> or at the start of the document
  const headIdx = html.indexOf('<head>');
  if (headIdx !== -1) {
    const insertPos = headIdx + 6; // after <head>
    return html.substring(0, insertPos) + '\n' + iframeCss + html.substring(insertPos);
  }

  const headWithAttrs = html.indexOf('<head ');
  if (headWithAttrs !== -1) {
    const closeAngle = html.indexOf('>', headWithAttrs);
    if (closeAngle !== -1) {
      const insertPos = closeAngle + 1;
      return html.substring(0, insertPos) + '\n' + iframeCss + html.substring(insertPos);
    }
  }

  // Fallback: prepend
  return iframeCss + html;
}
