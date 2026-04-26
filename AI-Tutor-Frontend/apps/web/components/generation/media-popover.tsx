'use client';

import { useState, useCallback, useMemo, useEffect, Fragment } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Image as ImageIcon,
  Video,
  Volume2,
  Mic,
  SlidersHorizontal,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import { useSettingsStore } from '@/lib/store/settings';
import { useTTSPreview } from '@/lib/audio/use-tts-preview';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { TTS_PROVIDERS, getTTSVoices } from '@/lib/audio/constants';
import { ASR_PROVIDERS, getASRSupportedLanguages } from '@/lib/audio/constants';
import type { ImageProviderId, VideoProviderId } from '@/lib/media/types';
import type { TTSProviderId, ASRProviderId } from '@/lib/audio/types';
import type { SettingsSection } from '@/lib/types/settings';

interface MediaPopoverProps {
  onSettingsOpen: (section: SettingsSection) => void;
}

// ─── Provider icon maps ───
const IMAGE_PROVIDER_ICONS: Record<string, string> = {
  seedream: '/logos/doubao.svg',
  'qwen-image': '/logos/bailian.svg',
  'nano-banana': '/logos/gemini.svg',
  'grok-image': '/logos/grok.svg',
};
const VIDEO_PROVIDER_ICONS: Record<string, string> = {
  seedance: '/logos/doubao.svg',
  kling: '/logos/kling.svg',
  veo: '/logos/gemini.svg',
  sora: '/logos/openai.svg',
  'grok-video': '/logos/grok.svg',
};

type TabId = 'tts' | 'asr';

const LANG_LABELS: Record<string, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  pt: 'Português',
  ru: 'Русский',
  it: 'Italiano',
  ar: 'العربية',
  hi: 'हिन्दी',
};

const LANGUAGE_CODES_DISPLAY: Record<string, string> = {
  'af-ZA': 'Afrikaans (South Africa)',
  'ar-EG': 'Arabic (Egypt) - العربية',
  'ar-SA': 'Arabic (Saudi Arabia) - العربية',
  'bg-BG': 'Bulgarian (Bulgaria) - Български',
  'ca-ES': 'Catalan (Spain) - Català',
  'cs-CZ': 'Czech (Czech Republic) - Čeština',
  'da-DK': 'Danish (Denmark) - Dansk',
  'de-DE': 'German (Germany) - Deutsch',
  'el-GR': 'Greek (Greece) - Ελληνικά',
  'en-AU': 'English (Australia)',
  'en-CA': 'English (Canada)',
  'en-GB': 'English (United Kingdom)',
  'en-IN': 'English (India)',
  'en-NZ': 'English (New Zealand)',
  'en-US': 'English (United States)',
  'en-ZA': 'English (South Africa)',
  'es-AR': 'Spanish (Argentina) - Español',
  'es-CO': 'Spanish (Colombia) - Español',
  'es-ES': 'Spanish (Spain) - Español',
  'es-MX': 'Spanish (Mexico) - Español',
  'fi-FI': 'Finnish (Finland) - Suomi',
  'fil-PH': 'Filipino (Philippines) - Filipino',
  'fr-FR': 'French (France) - Français',
  'he-IL': 'Hebrew (Israel) - עברית',
  'hi-IN': 'Hindi (India) - हिन्दी',
  'hr-HR': 'Croatian (Croatia) - Hrvatski',
  'hu-HU': 'Hungarian (Hungary) - Magyar',
  'id-ID': 'Indonesian (Indonesia) - Bahasa Indonesia',
  'is': 'Icelandic - Íslenska',
  'it-IT': 'Italian (Italy) - Italiano',
  'ja-JP': 'Japanese (Japan) - 日本語',
  'ko-KR': 'Korean (South Korea) - 한국어',
  'ms-MY': 'Malay (Malaysia) - Bahasa Melayu',
  'nl-NL': 'Dutch (Netherlands) - Nederlands',
  'no-NO': 'Norwegian (Norway) - Norsk',
  'pl-PL': 'Polish (Poland) - Polski',
  'pt-BR': 'Portuguese (Brazil) - Português',
  'pt-PT': 'Portuguese (Portugal) - Português',
  'ro-RO': 'Romanian (Romania) - Română',
  'ru-RU': 'Russian (Russia) - Русский',
  'sk-SK': 'Slovak (Slovakia) - Slovenčina',
  'sv-SE': 'Swedish (Sweden) - Svenska',
  'ta-IN': 'Tamil (India) - தமிழ்',
  'ta-LK': 'Tamil (Sri Lanka) - தமிழ்',
  'th-TH': 'Thai (Thailand) - ไทย',
  'tr-TR': 'Turkish (Turkey) - Türkçe',
  'uk-UA': 'Ukrainian (Ukraine) - Українська',
  'vi-VN': 'Vietnamese (Vietnam) - Tiếng Việt',
  'yue-Hant-HK': 'Cantonese (Traditional) - 粵語',
  'af': 'Afrikaans - Afrikaans',
  'ar': 'Arabic - العربية',
  'az': 'Azerbaijani - Azərbaycan',
  'be': 'Belarusian - Беларуская',
  'bg': 'Bulgarian - Български',
  'bs': 'Bosnian - Bosanski',
  'ca': 'Catalan - Català',
  'cs': 'Czech - Čeština',
  'cy': 'Welsh - Cymraeg',
  'da': 'Danish - Dansk',
  'de': 'German - Deutsch',
  'el': 'Greek - Ελληνικά',
  'en': 'English',
  'es': 'Spanish - Español',
  'et': 'Estonian - Eesti',
  'fa': 'Persian - فارسی',
  'fi': 'Finnish - Suomi',
  'fil': 'Filipino - Filipino',
  'fr': 'French - Français',
  'gl': 'Galician - Galego',
  'he': 'Hebrew - עברית',
  'hi': 'Hindi - हिन्दी',
  'hr': 'Croatian - Hrvatski',
  'hu': 'Hungarian - Magyar',
  'hy': 'Armenian - Հայերեն',
  'id': 'Indonesian - Bahasa Indonesia',
  'it': 'Italian - Italiano',
  'ja': 'Japanese - 日本語',
  'kk': 'Kazakh - Қазақша',
  'kn': 'Kannada - ಕನ್ನಡ',
  'ko': 'Korean - 한국어',
  'lt': 'Lithuanian - Lietuvių',
  'lv': 'Latvian - Latviešu',
  'mi': 'Maori - Māori',
  'mk': 'Macedonian - Македонски',
  'mr': 'Marathi - मराठी',
  'ms': 'Malay - Bahasa Melayu',
  'ne': 'Nepali - नेपाली',
  'nl': 'Dutch - Nederlands',
  'no': 'Norwegian - Norsk',
  'pl': 'Polish - Polski',
  'pt': 'Portuguese - Português',
  'ro': 'Romanian - Română',
  'ru': 'Russian - Русский',
  'sk': 'Slovak - Slovenčina',
  'sl': 'Slovenian - Slovenščina',
  'sr': 'Serbian - Српски',
  'sv': 'Swedish - Svenska',
  'sw': 'Swahili - Kiswahili',
  'ta': 'Tamil - தமிழ்',
  'th': 'Thai - ไทย',
  'tl': 'Tagalog - Tagalog',
  'tr': 'Turkish - Türkçe',
  'uk': 'Ukrainian - Українська',
  'ur': 'Urdu - اردو',
  'vi': 'Vietnamese - Tiếng Việt',
  'yue': 'Cantonese - 粵語',
  'zh': 'Chinese - 中文',
};

const TABS: Array<{ id: TabId; icon: LucideIcon; label: string }> = [
  { id: 'tts', icon: Volume2, label: 'TTS' },
  { id: 'asr', icon: Mic, label: 'ASR' },
];

/** Localized TTS provider name (mirrors audio-settings.tsx) */
function getTTSProviderName(providerId: TTSProviderId, t: (key: string) => string): string {
  const names: Record<TTSProviderId, string> = {
    'openai-tts': t('settings.providerOpenAITTS'),
    'azure-tts': t('settings.providerAzureTTS'),
    'glm-tts': t('settings.providerGLMTTS'),
    'qwen-tts': t('settings.providerQwenTTS'),
    'doubao-tts': t('settings.providerDoubaoTTS'),
    'elevenlabs-tts': t('settings.providerElevenLabsTTS'),
    'minimax-tts': t('settings.providerMiniMaxTTS'),
    'browser-native-tts': t('settings.providerBrowserNativeTTS'),
  };
  return names[providerId] || providerId;
}

/** Extract the English name from voice name format "ChineseName (English)" */
function getVoiceDisplayName(name: string, lang: string): string {
  if (lang === 'en-US') {
    const match = name.match(/\(([^)]+)\)/);
    return match ? match[1] : name;
  }
  return name;
}

export function MediaPopover({ onSettingsOpen }: MediaPopoverProps) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('tts');
  const { previewing, startPreview, stopPreview } = useTTSPreview();

  // ─── Store ───
  // Media features are always enabled (server-enforced)
  // Toggles removed for security — backend always includes these capabilities

  const imageProviderId = useSettingsStore((s) => s.imageProviderId);
  const imageModelId = useSettingsStore((s) => s.imageModelId);
  const imageProvidersConfig = useSettingsStore((s) => s.imageProvidersConfig);
  const setImageProvider = useSettingsStore((s) => s.setImageProvider);
  const setImageModelId = useSettingsStore((s) => s.setImageModelId);

  const videoProviderId = useSettingsStore((s) => s.videoProviderId);
  const videoModelId = useSettingsStore((s) => s.videoModelId);
  const videoProvidersConfig = useSettingsStore((s) => s.videoProvidersConfig);
  const setVideoProvider = useSettingsStore((s) => s.setVideoProvider);
  const setVideoModelId = useSettingsStore((s) => s.setVideoModelId);

  const ttsProviderId = useSettingsStore((s) => s.ttsProviderId);
  const ttsVoice = useSettingsStore((s) => s.ttsVoice);
  const ttsSpeed = useSettingsStore((s) => s.ttsSpeed);
  const ttsProvidersConfig = useSettingsStore((s) => s.ttsProvidersConfig);
  const setTTSProvider = useSettingsStore((s) => s.setTTSProvider);
  const setTTSVoice = useSettingsStore((s) => s.setTTSVoice);
  const setTTSSpeed = useSettingsStore((s) => s.setTTSSpeed);

  const asrProviderId = useSettingsStore((s) => s.asrProviderId);
  const asrLanguage = useSettingsStore((s) => s.asrLanguage);
  const asrProvidersConfig = useSettingsStore((s) => s.asrProvidersConfig);
  const setASRProvider = useSettingsStore((s) => s.setASRProvider);
  const setASRLanguage = useSettingsStore((s) => s.setASRLanguage);

  // All media features are always enabled
  const enabledMap: Record<TabId, boolean> = {
    tts: true,
    asr: true,
  };

  const cfgOk = (
    configs: Record<string, { apiKey?: string; isServerConfigured?: boolean }>,
    id: string,
    needsKey: boolean,
  ) => !needsKey || !!configs[id]?.apiKey || !!configs[id]?.isServerConfigured;

  const ttsSpeedRange = TTS_PROVIDERS[ttsProviderId]?.speedRange;

  // ─── Dynamic browser voices ───
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const load = () => setBrowserVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load);
  }, []);

  // ─── Grouped select data (only available providers) ───
  const imageGroups = useMemo(
    () =>
      Object.values(IMAGE_PROVIDERS)
        .filter((p) => cfgOk(imageProvidersConfig, p.id, p.requiresApiKey))
        .map((p) => ({
          groupId: p.id,
          groupName: p.name,
          groupIcon: IMAGE_PROVIDER_ICONS[p.id],
          available: true,
          items: [...p.models, ...(imageProvidersConfig[p.id]?.customModels || [])].map((m) => ({
            id: m.id,
            name: m.name,
          })),
        })),
    [imageProvidersConfig],
  );

  const videoGroups = useMemo(
    () =>
      Object.values(VIDEO_PROVIDERS)
        .filter((p) => cfgOk(videoProvidersConfig, p.id, p.requiresApiKey))
        .map((p) => ({
          groupId: p.id,
          groupName: p.name,
          groupIcon: VIDEO_PROVIDER_ICONS[p.id],
          available: true,
          items: [...p.models, ...(videoProvidersConfig[p.id]?.customModels || [])].map((m) => ({
            id: m.id,
            name: m.name,
          })),
        })),
    [videoProvidersConfig],
  );

  // TTS: grouped by provider, voices as items (matching Image/Video pattern)
  // Browser-native voices are split into sub-groups by language.
  const ttsGroups = useMemo(() => {
    const groups: SelectGroupData[] = [];

    for (const p of Object.values(TTS_PROVIDERS)) {
      if (p.requiresApiKey && !cfgOk(ttsProvidersConfig, p.id, p.requiresApiKey)) continue;

      const providerName = getTTSProviderName(p.id, t);

      // For browser-native-tts, split voices by language
      if (p.id === 'browser-native-tts' && browserVoices.length > 0) {
        const byLang = new Map<string, SpeechSynthesisVoice[]>();
        for (const v of browserVoices) {
          const langKey = v.lang.split('-')[0]; // "zh-CN" → "zh"
          if (!byLang.has(langKey)) byLang.set(langKey, []);
          byLang.get(langKey)!.push(v);
        }
        for (const [langKey, voices] of byLang) {
          const langLabel = LANG_LABELS[langKey] || langKey;
          groups.push({
            groupId: p.id,
            groupName: `${providerName} · ${langLabel}`,
            groupIcon: p.icon,
            available: true,
            items: voices.map((v) => ({ id: v.voiceURI, name: v.name })),
          });
        }
        continue;
      }

      groups.push({
        groupId: p.id,
        groupName: providerName,
        groupIcon: p.icon,
        available: true,
        items: getTTSVoices(p.id).map((v) => ({
          id: v.id,
          name: getVoiceDisplayName(v.name, locale),
        })),
      });
    }

    return groups;
  }, [ttsProvidersConfig, locale, browserVoices, t]);

  // TTS preview
  const handlePreview = useCallback(async () => {
    if (previewing) {
      stopPreview();
      return;
    }
    try {
      const providerConfig = ttsProvidersConfig[ttsProviderId];
      await startPreview({
        text: t('settings.ttsTestTextDefault'),
        providerId: ttsProviderId,
        modelId: providerConfig?.modelId,
        voice: ttsVoice,
        speed: ttsSpeed,
        apiKey: providerConfig?.apiKey,
        baseUrl: providerConfig?.baseUrl,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : t('settings.ttsTestFailed');
      toast.error(message);
    }
  }, [
    previewing,
    startPreview,
    stopPreview,
    t,
    ttsProviderId,
    ttsProvidersConfig,
    ttsSpeed,
    ttsVoice,
  ]);

  // ASR: only available providers
  const asrGroups = useMemo(
    () =>
      Object.values(ASR_PROVIDERS)
        .filter((p) => cfgOk(asrProvidersConfig, p.id, p.requiresApiKey))
        .map((p) => ({
          groupId: p.id,
          groupName: p.name,
          groupIcon: p.icon,
          available: true,
          items: getASRSupportedLanguages(p.id).map((l) => ({
            id: l,
            name: LANGUAGE_CODES_DISPLAY[l] || l,
          })),
        })),
    [asrProvidersConfig],
  );

  // Auto-select first enabled tab on open
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      stopPreview();
    }
    setOpen(isOpen);
    if (isOpen) {
      setActiveTab('tts');
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all cursor-pointer select-none whitespace-nowrap border',
            'bg-primary/10 text-primary border-primary/20 dark:border-primary/30 dark:bg-primary/20',
          )}
        >
          <SlidersHorizontal className="size-3.5" />
          <Volume2 className="size-3.5" />
          <Mic className="size-3.5" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" side="bottom" avoidCollisions={false} className="w-80 p-0 bg-card dark:bg-neutral-900 border-border dark:border-neutral-800 shadow-xl">
        {/* ── Tab bar (segmented control) ── */}
        <div className="p-2 pb-0">
          <div className="flex gap-0.5 p-0.5 bg-muted/60 dark:bg-neutral-800/60 rounded-lg">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const isEnabled = enabledMap[tab.id];
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[11px] font-medium transition-all relative',
                    isActive
                      ? 'bg-card dark:bg-neutral-900 text-foreground shadow-sm ring-1 ring-border/50 dark:ring-neutral-700/50'
                      : 'text-muted-foreground hover:text-foreground/80',
                  )}
                >
                  <Icon className="size-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  {isEnabled && !isActive && (
                    <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </div>


        {/* ── Tab content ── */}
        <div className="p-3 pt-2.5">

          {activeTab === 'tts' && (
            <TabPanel
              icon={Volume2}
              label={t('media.ttsCapability')}
            >
              <GroupedSelect
                groups={ttsGroups}
                selectedGroupId={ttsProviderId}
                selectedItemId={ttsVoice}
                onSelect={(gid, iid) => {
                  setTTSProvider(gid as TTSProviderId);
                  setTTSVoice(iid);
                }}
                onPreviewItem={(groupId, itemId) => {
                  const providerConfig = ttsProvidersConfig[groupId as TTSProviderId];
                  startPreview({
                    text: t('settings.ttsTestTextDefault'),
                    providerId: groupId as TTSProviderId,
                    modelId: providerConfig?.modelId,
                    voice: itemId,
                    speed: ttsSpeed,
                    apiKey: providerConfig?.apiKey,
                    baseUrl: providerConfig?.baseUrl,
                  }).catch(() => {});
                }}
                previewingItemId={previewing ? ttsVoice : null}
              />
            </TabPanel>
          )}

          {activeTab === 'asr' && (
            <TabPanel
              icon={Mic}
              label={t('media.asrCapability')}
            >
              <GroupedSelect
                groups={asrGroups}
                selectedGroupId={asrProviderId}
                selectedItemId={asrLanguage}
                onSelect={(gid, iid) => {
                  setASRProvider(gid as ASRProviderId);
                  setASRLanguage(iid);
                }}
              />
            </TabPanel>
          )}
        </div>

      </PopoverContent>
    </Popover>
  );
}

// ─── Tab panel: header (label) + body (always visible) ───
function TabPanel({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2.5">
        <Icon className="size-4 shrink-0 text-primary" />
        <span className="flex-1 text-sm font-medium">{label}</span>
        <span className="text-[10px] text-emerald-500 font-medium bg-emerald-500/10 px-1.5 py-0.5 rounded-full">ON</span>
      </div>
      {children}
    </div>
  );
}


// ─── Grouped provider+model select ───
interface SelectGroupData {
  groupId: string;
  groupName: string;
  groupIcon?: string;
  available: boolean;
  items: Array<{ id: string; name: string }>;
}

function GroupedSelect({
  groups,
  selectedGroupId,
  selectedItemId,
  onSelect,
  onPreviewItem,
  previewingItemId,
}: {
  groups: SelectGroupData[];
  selectedGroupId: string;
  selectedItemId: string;
  onSelect: (groupId: string, itemId: string) => void;
  onPreviewItem?: (groupId: string, itemId: string) => void;
  previewingItemId?: string | null;
}) {
  const [open, setOpen] = useState(false);

  const selectedGroup =
    groups.find(
      (g) => g.groupId === selectedGroupId && g.items.some((item) => item.id === selectedItemId),
    ) || groups.find((g) => g.groupId === selectedGroupId);

  const selectedItemName = selectedGroup?.items.find((item) => item.id === selectedItemId)?.name || selectedItemId;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          className="flex h-8 w-full items-center justify-between rounded-lg border border-border/40 bg-background/80 hover:bg-muted/40 px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring/30"
        >
          <span className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            {selectedGroup?.groupIcon && (
              <img src={selectedGroup.groupIcon} alt="" className="size-4 rounded-sm shrink-0" />
            )}
            <span className="font-medium truncate">{selectedGroup?.groupName}</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-muted-foreground truncate">{selectedItemName}</span>
          </span>
          <ChevronDown className="size-3 shrink-0 opacity-50 ml-2" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0 shadow-xl border-border dark:border-neutral-800" align="start">
        <Command>
          <CommandInput placeholder="Search options..." className="h-9 text-xs" />
          <CommandList className="max-h-60 overflow-y-auto">
            <CommandEmpty className="text-xs py-4 text-center text-muted-foreground">
              No matches found.
            </CommandEmpty>
            {groups.map((group, i) => (
              <CommandGroup key={`${group.groupId}-${i}`} heading={group.groupName}>
                {group.items.map((item) => (
                  <CommandItem
                    key={`${group.groupId}::${item.id}`}
                    value={`${group.groupName} ${item.name} ${item.id}`}
                    onSelect={() => {
                      onSelect(group.groupId, item.id);
                      setOpen(false);
                    }}
                    className="text-xs cursor-pointer group/item"
                    disabled={!group.available}
                  >
                    <span className="flex-1 truncate">{item.name}</span>
                    {onPreviewItem && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPreviewItem(group.groupId, item.id);
                        }}
                        className="ml-1.5 shrink-0 rounded p-0.5 text-muted-foreground/40 opacity-0 group-hover/item:opacity-100 hover:!text-primary hover:bg-primary/10 transition-all"
                        title="Preview voice"
                      >
                        {previewingItemId === item.id
                          ? <Loader2 className="size-3 animate-spin" />
                          : <Volume2 className="size-3" />}
                      </button>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
