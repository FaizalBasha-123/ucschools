import React, { useState } from 'react';
import {
  hasCookieDecision,
  saveCookieConsent,
  applyAnalyticsConsent,
} from '../services/cookieConsent';

const CookieConsentBanner: React.FC = () => {
  const [visible, setVisible] = useState(!hasCookieDecision());

  if (!visible) return null;

  const choose = (analytics: boolean) => {
    saveCookieConsent(analytics);
    applyAnalyticsConsent(analytics);
    setVisible(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] px-4 pb-4">
      <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white/95 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="flex flex-col gap-3 p-4 md:flex-row md:items-end md:justify-between md:gap-5 md:p-5">
          <div className="space-y-1.5">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Cookies and Tracking Choices
            </p>
            <p className="max-w-3xl text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              We always use essential storage for security and site reliability. Analytics is optional and is disabled
              until you opt in. For users under 18, analytics should be declined unless verified guardian consent is
              available.
              <a className="ml-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400" href="/privacy-policy">
                Learn more
              </a>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={() => choose(false)}
            >
              Essential only
            </button>
            <button
              className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700"
              onClick={() => choose(true)}
            >
              Accept analytics
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CookieConsentBanner;
