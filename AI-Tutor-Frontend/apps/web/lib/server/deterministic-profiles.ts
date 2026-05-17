/**
 * Deterministic scene generation profiles.
 *
 * Computes learning, persona, layout, and pacing profiles from
 * quality mode and learning mode — no LLM needed.
 *
 * These profiles are injected into prompt templates as
 * {{sceneGenerationProfile}} to guide the LLM's generation
 * behavior without relying on prompt-level conditional logic.
 */

export interface SceneGenerationProfile {
  learningProfile: string;
  personaProfile: string;
  layoutProfile: string;
  pacingProfile: string;
}

interface BuildProfileParams {
  qualityMode: string;
  learningMode: string;
}

function buildLearningProfile(learningMode: string): string {
  switch (learningMode) {
    case 'exam':
      return (
        'Assessment-focused preparation mode. Content should be precise, ' +
        'definition-driven, and highlight common mistakes. Include practice ' +
        'questions and exam-style scenarios. Scaffolding: minimal — assume ' +
        'learner needs targeted review rather than step-by-step instruction.'
      );
    case 'placement_prep':
      return (
        'Diagnostic preparation mode. Content should follow a socratic ' +
        'questioning approach that probes understanding. Cover breadth across ' +
        'key topics. Include self-assessment checkpoints. ' +
        'Scaffolding: adaptive — start broad, narrow based on implicit difficulty.'
      );
    case 'revision':
      return (
        'Quick revision mode. Content should be compressed key points with ' +
        'explicit connections between related concepts. Prioritize summaries, ' +
        'comparison tables, and visual overviews. ' +
        'Scaffolding: high — assume learner has seen the material before.'
      );
    case 'explain':
    default:
      return (
        'Step-by-step explanatory mode. Content should build from foundational ' +
        'to advanced concepts with real-world examples at each stage. ' +
        'Include analogies and concrete illustrations. ' +
        'Scaffolding: full — assume no prior knowledge of the topic.'
      );
  }
}

function buildPersonaProfile(qualityMode: string): string {
  switch (qualityMode) {
    case 'premium':
      return (
        'Tone: authoritative and thorough. Verbosity: detailed but structured. ' +
        'Style: comprehensive coverage with deep dives into nuance. ' +
        'Use precise terminology and cite specific examples. ' +
        'No teacher name or identity on slides — titles and keyPoints must be neutral.'
      );
    case 'basic':
      return (
        'Tone: approachable and encouraging. Verbosity: concise. ' +
        'Style: focus on core concepts with intuitive explanations. ' +
        'Use simple language and relatable examples. ' +
        'No teacher name or identity on slides — titles and keyPoints must be neutral.'
      );
    case 'standard':
    default:
      return (
        'Tone: friendly and professional. Verbosity: balanced. ' +
        'Style: step-by-step with real-world examples. ' +
        'Mix accessible language with appropriate technical terms. ' +
        'No teacher name or identity on slides — titles and keyPoints must be neutral.'
      );
  }
}

function buildLayoutProfile(): string {
  return (
    'Layout: clean and readable. Each slide should have a clear title, ' +
    'supporting visual elements (diagrams, tables, or images where relevant), ' +
    'and concise bullet points. Avoid clutter — limit to 4-6 key items per slide. ' +
    'Use consistent visual hierarchy: title > subtitle > body > caption.'
  );
}

function buildPacingProfile(learningMode: string): string {
  switch (learningMode) {
    case 'exam':
      return (
        'Pacing: brisk and focused. Every scene should deliver high-density ' +
        'information. Include a checkpoint (mini-quiz or review prompt) ' +
        'every 3-4 slides. Total scene count: 8-15.'
      );
    case 'placement_prep':
      return (
        'Pacing: moderate with diagnostic pauses. Include self-assessment ' +
        'questions after each major section. Total scene count: 6-12.'
      );
    case 'revision':
      return (
        'Pacing: fast. Prioritize coverage over depth. Use overview tables ' +
        'and comparison matrices. Total scene count: 5-10.'
      );
    case 'explain':
    default:
      return (
        'Pacing: steady and thorough. Each concept gets its own scene ' +
        'with clear progression. Include summary slides at section boundaries. ' +
        'Total scene count: 8-12.'
      );
  }
}

/**
 * Build a complete scene generation profile from quality and learning modes.
 */
export function buildSceneGenerationProfile(
  params: BuildProfileParams,
): SceneGenerationProfile {
  return {
    learningProfile: buildLearningProfile(params.learningMode),
    personaProfile: buildPersonaProfile(params.qualityMode),
    layoutProfile: buildLayoutProfile(),
    pacingProfile: buildPacingProfile(params.learningMode),
  };
}

/**
 * Format a SceneGenerationProfile as a markdown string for prompt injection.
 */
export function formatSceneGenerationProfile(profile: SceneGenerationProfile): string {
  return [
    '## Scene Generation Profile',
    '',
    '### Learning Profile',
    profile.learningProfile,
    '',
    '### Teaching Persona',
    profile.personaProfile,
    '',
    '### Layout Preferences',
    profile.layoutProfile,
    '',
    '### Pacing Guide',
    profile.pacingProfile,
  ].join('\n');
}

/**
 * Convenience: build and format a scene generation profile in one call.
 */
export function buildAndFormatProfile(params: BuildProfileParams): string {
  return formatSceneGenerationProfile(buildSceneGenerationProfile(params));
}
