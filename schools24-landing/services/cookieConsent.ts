export type CookieConsent = {
  essential: true;
  analytics: boolean;
  updatedAt: string;
  policyVersion: string;
};

const STORAGE_KEY = 'myschools_cookie_consent_v1';
const POLICY_VERSION = '2026-03-17';
const GA_MEASUREMENT_ID = 'G-4GEYNE69TR';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __myschoolsGaLoaded?: boolean;
  }
}

function readRaw(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function getCookieConsent(): CookieConsent | null {
  try {
    const raw = readRaw();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CookieConsent;
    if (typeof parsed?.analytics !== 'boolean') return null;
    return {
      essential: true,
      analytics: parsed.analytics,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      policyVersion: parsed.policyVersion || POLICY_VERSION,
    };
  } catch {
    return null;
  }
}

export function saveCookieConsent(analytics: boolean): CookieConsent {
  const value: CookieConsent = {
    essential: true,
    analytics,
    updatedAt: new Date().toISOString(),
    policyVersion: POLICY_VERSION,
  };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  }
  return value;
}

export function hasCookieDecision(): boolean {
  return getCookieConsent() !== null;
}

function ensureGtagBootstrap() {
  if (typeof window === 'undefined') return;
  if (!window.dataLayer) {
    window.dataLayer = [];
  }
  if (!window.gtag) {
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer!.push(args);
    };
  }
}

function ensureGAScriptLoaded() {
  if (typeof document === 'undefined') return;
  if (window.__myschoolsGaLoaded) return;
  const existing = document.querySelector(`script[src*="googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}"]`);
  if (existing) {
    window.__myschoolsGaLoaded = true;
    return;
  }

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  script.onload = () => {
    window.__myschoolsGaLoaded = true;
  };
  document.head.appendChild(script);
}

export function applyAnalyticsConsent(analyticsAllowed: boolean) {
  if (typeof window === 'undefined') return;

  ensureGtagBootstrap();
  window.gtag!('consent', 'default', {
    analytics_storage: analyticsAllowed ? 'granted' : 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
  });

  if (!analyticsAllowed) return;

  ensureGAScriptLoaded();
  window.gtag!('js', new Date());
  window.gtag!('config', GA_MEASUREMENT_ID, {
    anonymize_ip: true,
  });
}

export function initializeConsentMode() {
  const consent = getCookieConsent();
  applyAnalyticsConsent(consent?.analytics === true);
}
