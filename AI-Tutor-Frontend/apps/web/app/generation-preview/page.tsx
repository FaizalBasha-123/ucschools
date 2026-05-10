'use client';

import { useEffect, useState, Suspense, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  XCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useStageStore } from '@/lib/store/stage';
import { useSettingsStore } from '@/lib/store/settings';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { getAvailableProvidersWithVoices } from '@/lib/audio/voice-resolver';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  loadImageMapping,
  loadPdfBlob,
  cleanupOldImages,
} from '@/lib/utils/image-storage';
import { getCurrentModelConfig } from '@/lib/utils/model-config';
import { db } from '@/lib/utils/database';
import { MAX_PDF_CONTENT_CHARS, MAX_VISION_IMAGES } from '@/lib/constants/generation';
import { nanoid } from 'nanoid';
import type { Stage } from '@/lib/types/stage';
import type { SceneOutline, PdfImage, ImageMapping } from '@/lib/types/generation';
import { AgentRevealModal } from '@/components/agent/agent-reveal-modal';
import { createLogger } from '@/lib/logger';
import { getSessionToken, hasAuthSessionHint } from '@/lib/auth/session';
import { type GenerationSessionState, ALL_STEPS, getActiveSteps } from './types';

const log = createLogger('GenerationPreview');

function GenerationPreviewContent() {
  const router = useRouter();
  const { t } = useI18n();
  const hasStartedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const [session, setSession] = useState<GenerationSessionState | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isComplete] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [streamingOutlines, setStreamingOutlines] = useState<SceneOutline[] | null>(null);
  const [truncationWarnings, setTruncationWarnings] = useState<string[]>([]);
  const [webSearchSources, setWebSearchSources] = useState<Array<{ title: string; url: string }>>(
    [],
  );
  const [showAgentReveal, setShowAgentReveal] = useState(false);
  const [generatedAgents, setGeneratedAgents] = useState<
    Array<{
      id: string;
      name: string;
      role: string;
      persona: string;
      avatar: string;
      color: string;
      priority: number;
    }>
  >([]);
  const agentRevealResolveRef = useRef<(() => void) | null>(null);

  // Compute active steps based on session state
  const activeSteps = getActiveSteps(session);

  // Load session from sessionStorage
  useEffect(() => {
    cleanupOldImages(24).catch((e) => log.error(e));

    const saved = sessionStorage.getItem('generationSession');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as GenerationSessionState;
        setSession(parsed);
      } catch (e) {
        log.error('Failed to parse generation session:', e);
      }
    }
    setSessionLoaded(true);
  }, []);

  useEffect(() => {
    if (!sessionLoaded) return;
    if (!hasAuthSessionHint()) {
      router.replace('/auth?next=/');
    }
  }, [sessionLoaded, router]);

  // Abort all in-flight requests on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Get API credentials from localStorage
  const getApiHeaders = () => {
    const modelConfig = getCurrentModelConfig();
    const settings = useSettingsStore.getState();
    const imageProviderConfig = settings.imageProvidersConfig?.[settings.imageProviderId];
    const videoProviderConfig = settings.videoProvidersConfig?.[settings.videoProviderId];
    const token = getSessionToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'x-api-key': modelConfig.apiKey,
      'x-base-url': modelConfig.baseUrl,
      'x-provider-type': modelConfig.providerType || '',
      'x-requires-api-key': modelConfig.requiresApiKey ? 'true' : 'false',
      'x-model': modelConfig.providerId && modelConfig.modelId ? modelConfig.modelString : '',
      // Quality and learning mode headers
      'x-quality-mode': settings.qualityMode || 'standard',
      'x-learning-mode': settings.learningMode || 'explain',
      // Image generation provider
      'x-image-provider': settings.imageProviderId || '',
      'x-image-model': settings.imageModelId || '',
      'x-image-api-key': imageProviderConfig?.apiKey || '',
      'x-image-base-url': imageProviderConfig?.baseUrl || '',
      // Video generation provider
      'x-video-provider': settings.videoProviderId || '',
      'x-video-model': settings.videoModelId || '',
      'x-video-api-key': videoProviderConfig?.apiKey || '',
      'x-video-base-url': videoProviderConfig?.baseUrl || '',
      // Media generation toggles
      'x-image-generation-enabled': String(settings.imageGenerationEnabled ?? false),
      'x-video-generation-enabled': String(settings.videoGenerationEnabled ?? false),
    };
  };

  // Auto-start generation when session is loaded
  useEffect(() => {
    if (session && !hasStartedRef.current) {
      hasStartedRef.current = true;
      startGeneration();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Main generation flow
  const startGeneration = async () => {
    if (!session) return;

    // Create AbortController for this generation run
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    // Use a local mutable copy so we can update it after PDF parsing
    let currentSession = session;

    setError(null);
    setCurrentStepIndex(0);

    try {
      // Compute active steps for this session (recomputed after session mutations)
      let activeSteps = getActiveSteps(currentSession);

      // Determine if we need the PDF analysis step
      const hasPdfToAnalyze = !!currentSession.pdfStorageKey && !currentSession.pdfText;
      // If no PDF to analyze, skip to the next available step
      if (!hasPdfToAnalyze) {
        const firstNonPdfIdx = activeSteps.findIndex((s) => s.id !== 'pdf-analysis');
        setCurrentStepIndex(Math.max(0, firstNonPdfIdx));
      }

      // Step 0: Parse PDF if needed
      if (hasPdfToAnalyze) {
        log.debug('=== Generation Preview: Parsing PDF ===');
        const pdfBlob = await loadPdfBlob(currentSession.pdfStorageKey!);
        if (!pdfBlob) {
          throw new Error(t('generation.pdfLoadFailed'));
        }

        // Ensure pdfBlob is a valid Blob with content
        if (!(pdfBlob instanceof Blob) || pdfBlob.size === 0) {
          log.error('Invalid PDF blob:', {
            type: typeof pdfBlob,
            size: pdfBlob instanceof Blob ? pdfBlob.size : 'N/A',
          });
          throw new Error(t('generation.pdfLoadFailed'));
        }

        // Wrap as a File to guarantee multipart/form-data with correct content-type
        const pdfFile = new File([pdfBlob], currentSession.pdfFileName || 'document.pdf', {
          type: 'application/pdf',
        });

        const parseFormData = new FormData();
        parseFormData.append('pdf', pdfFile);

        if (currentSession.pdfProviderId) {
          parseFormData.append('providerId', currentSession.pdfProviderId);
        }
        if (currentSession.pdfProviderConfig?.apiKey?.trim()) {
          parseFormData.append('apiKey', currentSession.pdfProviderConfig.apiKey);
        }
        if (currentSession.pdfProviderConfig?.baseUrl?.trim()) {
          parseFormData.append('baseUrl', currentSession.pdfProviderConfig.baseUrl);
        }

        const parseResponse = await fetch('/api/parse-pdf', {
          method: 'POST',
          headers: (() => {
            const token = getSessionToken();
            const headers: Record<string, string> = {};
            if (token) headers.Authorization = `Bearer ${token}`;
            return headers;
          })(),
          body: parseFormData,
          signal,
        });

        if (!parseResponse.ok) {
          const errorData = await parseResponse.json();
          throw new Error(errorData.error || t('generation.pdfParseFailed'));
        }

        const parseResult = await parseResponse.json();
        if (!parseResult.success || !parseResult.data) {
          throw new Error(t('generation.pdfParseFailed'));
        }

        let pdfText = parseResult.data.text as string;

        // Truncate if needed
        if (pdfText.length > MAX_PDF_CONTENT_CHARS) {
          pdfText = pdfText.substring(0, MAX_PDF_CONTENT_CHARS);
        }

        const meta = parseResult.data.metadata;

        const pageMetadatas = meta?.pages || [];
        const imageReferences = meta?.imageReferences || [];
        const pageSummaries = meta?.pageSummaries || [];
        const scannedPages = meta?.scannedPages || [];

        // Update session with parsed PDF data
        const updatedSession = {
          ...currentSession,
          pdfText,
          pageMetadatas,
          imageReferences,
          pageSummaries,
          scannedPages,
          pdfStorageKey: undefined,
        };
        setSession(updatedSession);
        sessionStorage.setItem('generationSession', JSON.stringify(updatedSession));

        // Truncation warning
        const warnings: string[] = [];
        if ((parseResult.data.text as string).length > MAX_PDF_CONTENT_CHARS) {
          warnings.push(t('generation.textTruncated', { n: MAX_PDF_CONTENT_CHARS }));
        }
        if (scannedPages.length > 0) {
          warnings.push(
            t('generation.scannedPagesDetected', { pages: scannedPages.join(', ') }),
          );
        }
        if (warnings.length > 0) {
          setTruncationWarnings(warnings);
        }

        // Reassign local reference for subsequent steps
        currentSession = updatedSession;
        activeSteps = getActiveSteps(currentSession);
      }

      // Step: Web Search (if enabled) — graceful degradation on failure
      const webSearchStepIdx = activeSteps.findIndex((s) => s.id === 'web-search');
      if (currentSession.requirements.webSearch && webSearchStepIdx >= 0) {
        setCurrentStepIndex(webSearchStepIdx);
        setWebSearchSources([]);

        try {
          const wsSettings = useSettingsStore.getState();
          const wsApiKey =
            wsSettings.webSearchProvidersConfig?.[wsSettings.webSearchProviderId]?.apiKey;
          const res = await fetch('/api/web-search', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
              query: currentSession.requirements.requirement,
              pdfText: currentSession.pdfText || undefined,
              apiKey: wsApiKey || undefined,
            }),
            signal,
          });

          if (res.ok) {
            const searchData = await res.json();
            const sources = (searchData.sources || []).map(
              (s: { title: string; url: string }) => ({
                title: s.title,
                url: s.url,
              }),
            );
            setWebSearchSources(sources);

            const updatedSessionWithSearch = {
              ...currentSession,
              researchContext: searchData.context || '',
              researchSources: sources,
            };
            setSession(updatedSessionWithSearch);
            sessionStorage.setItem('generationSession', JSON.stringify(updatedSessionWithSearch));
            currentSession = updatedSessionWithSearch;
            activeSteps = getActiveSteps(currentSession);
          } else {
            // Non-fatal: web search failed (e.g. missing API key, upstream error)
            // Continue generation without search context.
            const errData = await res.json().catch(() => ({}));
            log.warn(
              `[GenerationPreview] Web search skipped (${res.status}): ${errData.error || 'unknown error'}`,
            );
          }
        } catch (webErr) {
          // Abort signal = user navigated away — propagate that.
          if (webErr instanceof DOMException && webErr.name === 'AbortError') throw webErr;
          // Any other error: skip web search, continue generation.
          log.warn('[GenerationPreview] Web search failed, continuing without search context:', webErr);
        }
      }

      // Load imageMapping early (needed for both outline and scene generation)
      let imageMapping: ImageMapping = {};
      if (currentSession.imageStorageIds && currentSession.imageStorageIds.length > 0) {
        log.debug('Loading images from IndexedDB');
        imageMapping = await loadImageMapping(currentSession.imageStorageIds);
      } else if (
        currentSession.imageMapping &&
        Object.keys(currentSession.imageMapping).length > 0
      ) {
        log.debug('Using imageMapping from session (old format)');
        imageMapping = currentSession.imageMapping;
      }

      // ── Agent generation (before outlines so persona can influence structure) ──
      const settings = useSettingsStore.getState();
      let agents: Array<{
        id: string;
        name: string;
        role: string;
        persona?: string;
      }> = [];

      // Create stage client-side (needed for agent generation stageId)
      const stageId = nanoid(10);
      const stage: Stage = {
        id: stageId,
        name: extractTopicFromRequirement(currentSession.requirements.requirement),
        description: '',
        language: currentSession.requirements.language || 'zh-CN',
        style: 'professional',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      if (settings.agentMode === 'auto') {
        const agentStepIdx = activeSteps.findIndex((s) => s.id === 'agent-generation');
        if (agentStepIdx >= 0) setCurrentStepIndex(agentStepIdx);

        try {
          const allAvatars = [
            {
              path: '/avatars/teacher.png',
              desc: 'Male teacher with glasses, holding a book, green background',
            },
            {
              path: '/avatars/teacher-2.png',
              desc: 'Female teacher with long dark hair, blue traditional outfit, gentle expression',
            },
            {
              path: '/avatars/assist.png',
              desc: 'Young female assistant with glasses, pink background, friendly smile',
            },
            {
              path: '/avatars/assist-2.png',
              desc: 'Young female in orange top and purple overalls, cheerful and approachable',
            },
            {
              path: '/avatars/clown.png',
              desc: 'Energetic girl with glasses pointing up, green shirt, lively and fun',
            },
            {
              path: '/avatars/clown-2.png',
              desc: 'Playful girl with curly hair doing rock gesture, blue shirt, humorous vibe',
            },
            {
              path: '/avatars/curious.png',
              desc: 'Surprised boy with glasses, hand on cheek, curious expression',
            },
            {
              path: '/avatars/curious-2.png',
              desc: 'Boy with backpack holding a book and question mark bubble, inquisitive',
            },
            {
              path: '/avatars/note-taker.png',
              desc: 'Studious boy with glasses, blue shirt, calm and organized',
            },
            {
              path: '/avatars/note-taker-2.png',
              desc: 'Active boy with yellow backpack waving, blue outfit, enthusiastic learner',
            },
            {
              path: '/avatars/thinker.png',
              desc: 'Thoughtful girl with hand on chin, purple background, contemplative',
            },
            {
              path: '/avatars/thinker-2.png',
              desc: 'Girl reading a book intently, long dark hair, intellectual and focused',
            },
          ];

          const getAvailableVoicesForGeneration = () => {
            const providers = getAvailableProvidersWithVoices(settings.ttsProvidersConfig);
            return providers.flatMap((p) =>
              p.voices.map((v) => ({
                providerId: p.providerId,
                voiceId: v.id,
                voiceName: v.name,
              })),
            );
          };

          // No outlines yet — agent generation uses only stage name + description
          const agentResp = await fetch('/api/generate/agent-profiles', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
              stageInfo: { name: stage.name, description: stage.description },
              language: currentSession.requirements.language || 'zh-CN',
              availableAvatars: allAvatars.map((a) => a.path),
              avatarDescriptions: allAvatars.map((a) => ({ path: a.path, desc: a.desc })),
              availableVoices: getAvailableVoicesForGeneration(),
            }),
            signal,
          });

          if (!agentResp.ok) throw new Error('Agent generation failed');
          const agentData = await agentResp.json();
          if (!agentData.success) throw new Error(agentData.error || 'Agent generation failed');

          // Save to IndexedDB and registry
          const { saveGeneratedAgents } = await import('@/lib/orchestration/registry/store');
          const savedIds = await saveGeneratedAgents(stage.id, agentData.agents);
          settings.setSelectedAgentIds(savedIds);
          stage.agentIds = savedIds;

          // Show card-reveal modal, continue generation once all cards are revealed
          setGeneratedAgents(agentData.agents);
          setShowAgentReveal(true);
          await new Promise<void>((resolve) => {
            agentRevealResolveRef.current = resolve;
          });

          agents = savedIds
            .map((id) => useAgentRegistry.getState().getAgent(id))
            .filter(Boolean)
            .map((a) => ({
              id: a!.id,
              name: a!.name,
              role: a!.role,
              persona: a!.persona,
            }));
        } catch (err: unknown) {
          log.warn('[Generation] Agent generation failed, falling back to presets:', err);
          const registry = useAgentRegistry.getState();
          const fallbackIds = settings.selectedAgentIds.filter((id) => {
            const a = registry.getAgent(id);
            return a && !a.isGenerated;
          });
          agents = fallbackIds
            .map((id) => registry.getAgent(id))
            .filter(Boolean)
            .map((a) => ({
              id: a!.id,
              name: a!.name,
              role: a!.role,
              persona: a!.persona,
            }));
          stage.agentIds = fallbackIds;
        }
      } else {
        // Preset mode — use selected agents (include persona)
        // Filter out stale generated agent IDs that may linger in settings
        const registry = useAgentRegistry.getState();
        const presetAgentIds = settings.selectedAgentIds.filter((id) => {
          const a = registry.getAgent(id);
          return a && !a.isGenerated;
        });
        agents = presetAgentIds
          .map((id) => registry.getAgent(id))
          .filter(Boolean)
          .map((a) => ({
            id: a!.id,
            name: a!.name,
            role: a!.role,
            persona: a!.persona,
          }));
        stage.agentIds = presetAgentIds;
      }

      // ── Generate outlines (with agent personas for teacher context) ──
      let outlines = currentSession.sceneOutlines;

      const outlineStepIdx = activeSteps.findIndex((s) => s.id === 'outline');
      setCurrentStepIndex(outlineStepIdx >= 0 ? outlineStepIdx : 0);
      if (!outlines || outlines.length === 0) {
        log.debug('=== Generating outlines (SSE) ===');
        setStreamingOutlines([]);

        outlines = await new Promise<SceneOutline[]>((resolve, reject) => {
          const collected: SceneOutline[] = [];

          fetch('/api/generate/scene-outlines-stream', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({
              requirements: currentSession.requirements,
              pdfText: currentSession.pdfText,
              pdfImages: currentSession.pdfImages,
              imageMapping,
              researchContext: currentSession.researchContext,
              agents,
              pageSummaries: currentSession.pageSummaries,
            }),
            signal,
          })
            .then((res) => {
              if (!res.ok) {
                return res.json().then((d) => {
                  reject(new Error(d.error || t('generation.outlineGenerateFailed')));
                });
              }

              const reader = res.body?.getReader();
              if (!reader) {
                reject(new Error(t('generation.streamNotReadable')));
                return;
              }

              const decoder = new TextDecoder();
              let sseBuffer = '';

              const pump = (): Promise<void> =>
                reader.read().then(({ done, value }) => {
                  if (value) {
                    sseBuffer += decoder.decode(value, { stream: !done });
                    const lines = sseBuffer.split('\n');
                    sseBuffer = lines.pop() || '';

                    for (const line of lines) {
                      if (!line.startsWith('data: ')) continue;
                      try {
                        const evt = JSON.parse(line.slice(6));
                        if (evt.type === 'outline') {
                          collected.push(evt.data);
                          setStreamingOutlines([...collected]);
                        } else if (evt.type === 'retry') {
                          collected.length = 0;
                          setStreamingOutlines([]);
                          setStatusMessage(t('generation.outlineRetrying'));
                        } else if (evt.type === 'done') {
                          resolve(evt.outlines || collected);
                          return;
                        } else if (evt.type === 'error') {
                          reject(new Error(evt.error));
                          return;
                        }
                      } catch (e) {
                        log.error('Failed to parse outline SSE:', line, e);
                      }
                    }
                  }
                  if (done) {
                    if (collected.length > 0) {
                      resolve(collected);
                    } else {
                      reject(new Error(t('generation.outlineEmptyResponse')));
                    }
                    return;
                  }
                  return pump();
                });

              pump().catch(reject);
            })
            .catch(reject);
        });

        const updatedSession = { ...currentSession, sceneOutlines: outlines };
        setSession(updatedSession);
        sessionStorage.setItem('generationSession', JSON.stringify(updatedSession));

        // Outline generation succeeded — clear homepage draft cache
        try {
          localStorage.removeItem('requirementDraft');
        } catch {
          /* ignore */
        }

        // Brief pause to let user see the final outline state
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      // Move to scene generation step
      setStatusMessage('');
      if (!outlines || outlines.length === 0) {
        throw new Error(t('generation.outlineEmptyResponse'));
      }

      // Store stage and outlines
      const store = useStageStore.getState();
      store.setStage(stage);
      store.setOutlines(outlines);

      // Advance to slide-content step
      const contentStepIdx = activeSteps.findIndex((s) => s.id === 'slide-content');
      if (contentStepIdx >= 0) setCurrentStepIndex(contentStepIdx);

      // Build stageInfo and userProfile for API call
      const stageInfo = {
        name: stage.name,
        description: stage.description,
        language: stage.language,
        style: stage.style,
      };

      const userProfile =
        currentSession.requirements.userNickname || currentSession.requirements.userBio
          ? `Student: ${currentSession.requirements.userNickname || 'Unknown'}${currentSession.requirements.userBio ? ` — ${currentSession.requirements.userBio}` : ''}`
          : undefined;

      // Generate ONLY the first scene
      store.setGeneratingOutlines(outlines);

      const firstOutline = outlines[0];

      // Step 2: Generate content (currentStepIndex is already 2)
      const contentResp = await fetch('/api/generate/scene-content', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          outline: firstOutline,
          allOutlines: outlines,
          pdfImages: currentSession.pdfImages,
          imageMapping,
          stageInfo,
          stageId: stage.id,
          agents,
          pageMetadatas: currentSession.pageMetadatas,
          imageReferences: currentSession.imageReferences,
        }),
        signal,
      });

      if (!contentResp.ok) {
        const errorData = await contentResp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errorData.error || t('generation.sceneGenerateFailed'));
      }

      const contentData = await contentResp.json();
      if (!contentData.success || !contentData.content) {
        throw new Error(contentData.error || t('generation.sceneGenerateFailed'));
      }

      // Generate actions (activate actions step indicator)
      const actionsStepIdx = activeSteps.findIndex((s) => s.id === 'actions');
      setCurrentStepIndex(actionsStepIdx >= 0 ? actionsStepIdx : currentStepIndex + 1);

      const actionsResp = await fetch('/api/generate/scene-actions', {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({
          outline: contentData.effectiveOutline || firstOutline,
          allOutlines: outlines,
          content: contentData.content,
          stageId: stage.id,
          agents,
          previousSpeeches: [],
          userProfile,
        }),
        signal,
      });

      if (!actionsResp.ok) {
        const errorData = await actionsResp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errorData.error || t('generation.sceneGenerateFailed'));
      }

      const data = await actionsResp.json();
      if (!data.success || !data.scene) {
        throw new Error(data.error || t('generation.sceneGenerateFailed'));
      }

      // Generate TTS for first scene (part of actions step — blocking)
      if (settings.ttsEnabled && settings.ttsProviderId !== 'browser-native-tts') {
        const ttsProviderConfig = settings.ttsProvidersConfig?.[settings.ttsProviderId];
        const speechActions = (data.scene.actions || []).filter(
          (a: { type: string; text?: string }) => a.type === 'speech' && a.text,
        );

        let ttsFailCount = 0;
        for (const action of speechActions) {
          const audioId = `tts_${action.id}`;
          action.audioId = audioId;
          try {
            const resp = await fetch('/api/generate/tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: action.text,
                audioId,
                ttsProviderId: settings.ttsProviderId,
                ttsModelId: ttsProviderConfig?.modelId,
                ttsVoice: settings.ttsVoice,
                ttsSpeed: settings.ttsSpeed,
                ttsApiKey: ttsProviderConfig?.apiKey || undefined,
                ttsBaseUrl: ttsProviderConfig?.baseUrl || undefined,
              }),
              signal,
            });
            if (!resp.ok) {
              ttsFailCount++;
              continue;
            }
            const ttsData = await resp.json();
            if (!ttsData.success) {
              ttsFailCount++;
              continue;
            }
            const binary = atob(ttsData.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: `audio/${ttsData.format}` });
            await db.audioFiles.put({
              id: audioId,
              blob,
              format: ttsData.format,
              createdAt: Date.now(),
            });
          } catch (err) {
            log.warn(`[TTS] Failed for ${audioId}:`, err);
            ttsFailCount++;
          }
        }

        if (ttsFailCount > 0 && speechActions.length > 0) {
          throw new Error(t('generation.speechFailed'));
        }
      }

      // Add scene to store and navigate
      store.addScene(data.scene);
      store.setCurrentSceneId(data.scene.id);

      // Set remaining outlines as skeleton placeholders
      const remaining = outlines.filter((o) => o.order !== data.scene.order);
      store.setGeneratingOutlines(remaining);

      // Store generation params for classroom to continue generation
      sessionStorage.setItem(
        'generationParams',
        JSON.stringify({
          pdfImages: currentSession.pdfImages,
          agents,
          userProfile,
        }),
      );

      sessionStorage.removeItem('generationSession');
      await store.saveToStorage();

      // ── Credit Deduction ─────────────────────────────────────────────────────
      // Fire-and-forget: deduct credits for this lesson from the user's balance.
      // Non-blocking: a failure here should not prevent navigation to the lesson.
      // The idempotency_key prevents double-deduction on page reload.
      const debitSettings = useSettingsStore.getState();
      const speechCharCount = (data.scene.actions || [])
        .filter((a: { type: string; text?: string }) => a.type === 'speech' && a.text)
        .reduce((sum: number, a: { text?: string }) => sum + (a.text?.length ?? 0), 0);
      fetch('/api/credits/deduct-lesson', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getSessionToken() ? { Authorization: `Bearer ${getSessionToken()}` } : {}),
        },
        body: JSON.stringify({
          lessonId: stage.id,
          qualityMode: currentSession.qualityMode || debitSettings.qualityMode || 'standard',
          learningMode: currentSession.learningMode || debitSettings.learningMode || 'explain',
          sceneCount: outlines.length,
          speechCharCount,
        }),
      }).catch((err) => log.warn('Credit deduction failed (non-fatal):', err));
      // ─────────────────────────────────────────────────────────────────────────

      router.push(`/lessons/${stage.id}`);
    } catch (err) {
      // AbortError is expected when navigating away — don't show as error
      if (err instanceof DOMException && err.name === 'AbortError') {
        log.info('[GenerationPreview] Generation aborted');
        return;
      }
      sessionStorage.removeItem('generationSession');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const extractTopicFromRequirement = (requirement: string): string => {
    const trimmed = requirement.trim();
    if (trimmed.length <= 500) {
      return trimmed;
    }
    return trimmed.substring(0, 500).trim() + '...';
  };

  const goBackToHome = () => {
    abortControllerRef.current?.abort();
    sessionStorage.removeItem('generationSession');
    router.push('/');
  };

  // Still loading session from sessionStorage
  if (!sessionLoaded) {
    return (
      <div className="min-h-[100dvh] bg-neutral-950 flex items-center justify-center">
        <Loader2 className="size-6 text-neutral-500 animate-spin" />
      </div>
    );
  }

  // No session found
  if (!session) {
    return (
      <div className="min-h-[100dvh] bg-neutral-950 flex items-center justify-center p-4">
        <Card className="p-8 max-w-md w-full bg-neutral-900 border-neutral-800">
          <div className="text-center space-y-4">
            <AlertCircle className="size-12 text-neutral-500 mx-auto" />
            <h2 className="text-xl font-semibold text-neutral-100">
              {t('generation.sessionNotFound')}
            </h2>
            <p className="text-sm text-neutral-500">{t('generation.sessionNotFoundDesc')}</p>
            <Button onClick={() => router.push('/')} className="w-full">
              <ArrowLeft className="size-4 mr-2" />
              {t('generation.backToHome')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const activeStep =
    activeSteps.length > 0
      ? activeSteps[Math.min(currentStepIndex, activeSteps.length - 1)]
      : ALL_STEPS[0];

  return (
    <div className="min-h-[100dvh] bg-neutral-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-neutral-800/60 px-6 py-4 flex items-center shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={goBackToHome}
          className="text-neutral-400 hover:text-white"
        >
          <ArrowLeft className="size-4 mr-2" />
          Back
        </Button>
        <div className="ml-4">
          <h1 className="text-sm font-medium text-neutral-200">Lesson Generation</h1>
          <p className="text-xs text-neutral-600">
            {activeStep ? t(activeStep.title) : 'Preparing...'}
          </p>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-lg">
          {/* Progress bar */}
          <div className="mb-8">
            <div className="flex justify-between text-xs text-neutral-500 mb-2">
              <span>Overall Progress</span>
              <span className="text-neutral-400">
                {Math.min(currentStepIndex, activeSteps.length)} of {activeSteps.length} steps
              </span>
            </div>
            <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
              <motion.div
                className={cn(
                  'h-full rounded-full',
                  error ? 'bg-red-500' : 'bg-emerald-500'
                )}
                initial={{ width: 0 }}
                animate={{
                  width: `${activeSteps.length > 0 ? (Math.min(currentStepIndex, activeSteps.length) / activeSteps.length) * 100 : 0}%`,
                }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
          </div>

          {/* Steps list */}
          <div className="space-y-2">
            {activeSteps.map((step, idx) => {
              const isCompleted = idx < currentStepIndex;
              const isActive = idx === currentStepIndex && !error;
              const isFailed = idx === currentStepIndex && !!error;
              const isPending = idx > currentStepIndex;

              return (
                <div
                  key={step.id}
                  className={cn(
                    'flex items-start gap-4 p-4 rounded-xl border transition-all duration-300',
                    isActive && 'bg-neutral-900/80 border-neutral-700/50',
                    isFailed && 'bg-red-950/10 border-red-900/30',
                    isCompleted && 'bg-transparent border-transparent opacity-70',
                    isPending && 'bg-transparent border-transparent opacity-40'
                  )}
                >
                  {/* Status icon */}
                  <div className="mt-0.5 shrink-0">
                    {isCompleted ? (
                      <CheckCircle2 className="size-5 text-emerald-500" />
                    ) : isFailed ? (
                      <XCircle className="size-5 text-red-500" />
                    ) : isActive ? (
                      <Loader2 className="size-5 text-blue-500 animate-spin" />
                    ) : (
                      <div className="size-5 rounded-full border-2 border-neutral-700" />
                    )}
                  </div>

                  {/* Step text */}
                  <div className="flex-1 min-w-0">
                    <h3
                      className={cn(
                        'text-sm font-medium',
                        isCompleted && 'text-emerald-400 line-through',
                        isFailed && 'text-red-300',
                        isActive && 'text-white',
                        isPending && 'text-neutral-500'
                      )}
                    >
                      {t(step.title)}
                    </h3>
                    <p
                      className={cn(
                        'text-xs mt-1 leading-relaxed',
                        isFailed && 'text-red-400',
                        isActive && 'text-neutral-400',
                        isCompleted && 'text-neutral-600',
                        isPending && 'text-neutral-700'
                      )}
                    >
                      {isFailed
                        ? error
                        : isActive
                          ? statusMessage || t(step.description)
                          : t(step.description)}
                    </p>

                    {/* Dynamic details */}
                    {step.id === 'outline' && isActive && streamingOutlines && streamingOutlines.length > 0 && (
                      <p className="text-xs text-blue-400 mt-2 font-mono">
                        {streamingOutlines.length} outline{streamingOutlines.length > 1 ? 's' : ''} generated
                      </p>
                    )}
                    {step.id === 'web-search' && isCompleted && webSearchSources.length > 0 && (
                      <p className="text-xs text-emerald-500 mt-2 font-mono">
                        {webSearchSources.length} source{webSearchSources.length > 1 ? 's' : ''} indexed
                      </p>
                    )}
                    {step.id === 'pdf-analysis' && isCompleted && (
                      <p className="text-xs text-emerald-500 mt-2 font-mono">
                        Document parsed successfully
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Truncation warnings */}
          {truncationWarnings.length > 0 && !error && (
            <div className="mt-4 p-3 bg-amber-950/20 border border-amber-900/30 rounded-lg flex items-start gap-2">
              <AlertTriangle className="size-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="text-xs text-amber-400 space-y-1">
                {truncationWarnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            </div>
          )}

          {/* Error actions */}
          {error && (
            <div className="mt-6 flex gap-3">
              <Button
                onClick={goBackToHome}
                className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-white border border-neutral-700"
              >
                <ArrowLeft className="size-4 mr-2" />
                Go Back & Retry
              </Button>
            </div>
          )}

          {/* View agents button */}
          {!error && generatedAgents.length > 0 && !showAgentReveal && (
            <div className="mt-6 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAgentReveal(true)}
                className="border-neutral-700 text-neutral-300 hover:bg-neutral-800 hover:text-white"
              >
                View Generated Agents
              </Button>
            </div>
          )}
        </div>
      </main>

      {/* Agent Reveal Modal */}
      <AgentRevealModal
        agents={generatedAgents}
        open={showAgentReveal}
        onClose={() => setShowAgentReveal(false)}
        onAllRevealed={() => {
          agentRevealResolveRef.current?.();
          agentRevealResolveRef.current = null;
        }}
      />
    </div>
  );
}

export default function GenerationPreviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[100dvh] bg-neutral-950 flex items-center justify-center">
          <Loader2 className="size-6 text-neutral-500 animate-spin" />
        </div>
      }
    >
      <GenerationPreviewContent />
    </Suspense>
  );
}
