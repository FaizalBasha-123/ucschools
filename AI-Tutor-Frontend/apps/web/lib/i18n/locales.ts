export type LocaleEntry = {
  code: string;
  /** Native name shown in dropdown, e.g. '简体中文' */
  label: string;
  /** Short label shown on the toggle button, e.g. 'CN' */
  shortLabel: string;
};

/**
 * Supported locales registry.
 *
 * To add a new language:
 *   1. Create `lib/i18n/locales/<code>.json` (copy an existing file as template)
 *   2. Add an entry here
 */
export const supportedLocales = [
  { code: 'en-US', label: 'English', shortLabel: 'EN' },
  { code: 'zh-CN', label: 'Chinese', shortLabel: 'ZH' },
  { code: 'te-IN', label: 'Telugu', shortLabel: 'TE' },
  { code: 'ml-IN', label: 'Malayalam', shortLabel: 'ML' },
  { code: 'kn-IN', label: 'Kannada', shortLabel: 'KN' },
  { code: 'ja-JP', label: 'Japanese', shortLabel: 'JA' },
  { code: 'fr-FR', label: 'French', shortLabel: 'FR' },
  { code: 'it-IT', label: 'Italian', shortLabel: 'IT' },
] as const satisfies readonly LocaleEntry[];
