'use client';

import { useEffect, useRef } from 'react';
import { setAuthSession, getOperatorToken } from '@/lib/auth/session';
import { createLogger } from '@/lib/logger';

const log = createLogger('GoogleOneTap');

const GOOGLE_GSI_SCRIPT = 'https://accounts.google.com/gsi/client';

interface GoogleOneTapProps {
  /** Called after a successful authentication. The parent should update its auth state. */
  onSuccess: (session: { token: string; accountId: string; email: string }) => void;
  /** Called when an error occurs. */
  onError?: (error: string) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          prompt: (callback?: (notification: { isNotDisplayed: () => boolean; isSkippedMoment: () => boolean; getDismissedReason: () => string }) => void) => void;
          cancel: () => void;
        };
      };
    };
  }
}

export function GoogleOneTap({ onSuccess, onError }: GoogleOneTapProps) {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      log.warn('NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set — skipping Google One Tap');
      return;
    }

    const handleCredentialResponse = async (response: { credential: string }) => {
      try {
        log.info('One Tap credential received, exchanging with backend...');

        const res = await fetch('/api/auth/google/onetap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: response.credential }),
          cache: 'no-store',
        });

        const json = await res.json();

        if (!res.ok || !json.success) {
          throw new Error(json.error || json.details || 'One Tap authentication failed');
        }

        const data = json.data || json;

        // Handle partial auth (phone verification required)
        if (data.status === 'partial_auth') {
          if (data.partial_auth_token) {
            sessionStorage.setItem('partialAuthToken', data.partial_auth_token);
          }
          if (data.account_id) {
            sessionStorage.setItem('partialAuthAccountId', data.account_id);
          }
          if (data.email) {
            sessionStorage.setItem('partialAuthEmail', data.email);
          }
          window.location.href = data.redirect_to || '/auth/verify-phone';
          return;
        }

        if (data.status && typeof data.status === 'string' && data.status !== 'active') {
          throw new Error(`Authentication incomplete: ${data.status}`);
        }

        // Store session
        setAuthSession({
          token: data.session_token,
          accountId: data.account_id,
          email: data.email,
        });

        log.info('One Tap sign-in successful for %s', data.email);
        onSuccess({
          token: data.session_token,
          accountId: data.account_id,
          email: data.email,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('One Tap exchange failed:', msg);
        onError?.(msg);
      }
    };

    // Load GSI script
    const loadScript = () => {
      if (document.querySelector(`script[src="${GOOGLE_GSI_SCRIPT}"]`)) {
        // Script already loaded, just initialize
        initOneTap();
        return;
      }

      const script = document.createElement('script');
      script.src = GOOGLE_GSI_SCRIPT;
      script.async = true;
      script.defer = true;
      script.onload = initOneTap;
      script.onerror = () => {
        log.error('Failed to load Google Identity Services script');
      };
      document.head.appendChild(script);
    };

    const initOneTap = () => {
      if (!window.google?.accounts?.id) {
        log.warn('Google Identity Services not available');
        return;
      }

      // Skip One Tap if already logged in (user or operator)
      const hasUserSession = typeof window !== 'undefined' && !!localStorage.getItem('aiTutorSessionToken');
      const hasOpSession = !!getOperatorToken();
      if (hasUserSession || hasOpSession) {
        return;
      }

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
        itp_support: true,
        use_fedcm_for_prompt: false, // Disable FedCM to avoid browser policy warnings/disabling
      });

      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed()) {
          log.info('One Tap not displayed: user may have dismissed or opted out');
        }
        if (notification.isSkippedMoment()) {
          log.info('One Tap skipped: %s', notification.getDismissedReason());
        }
      });
    };

    loadScript();

    return () => {
      // Cleanup: cancel the prompt if component unmounts
      try {
        window.google?.accounts?.id?.cancel();
      } catch {
        // no-op
      }
    };
  }, [onSuccess, onError]);

  // This component renders nothing — Google One Tap is a native browser popup
  return null;
}
