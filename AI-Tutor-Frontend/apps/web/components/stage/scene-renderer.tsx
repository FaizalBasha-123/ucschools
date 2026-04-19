'use client';

import { useMemo, type ReactNode } from 'react';
import type { Scene, SceneContent, StageMode } from '@/lib/types/stage';
import { SlideEditor as SlideRenderer } from '../slide-renderer/Editor';
import { QuizView } from '../scene-renderers/quiz-view';
import { InteractiveRenderer } from '../scene-renderers/interactive-renderer';
import { PBLRenderer } from '../scene-renderers/pbl-renderer';

export interface SceneRendererProps {
  readonly scene: Scene;
  readonly mode: StageMode;
}

type SceneRendererScene<T extends Scene['type']> = Omit<Extract<Scene, { type: T }>, 'content'> & {
  readonly content: Extract<SceneContent, { type: T }>;
};

function hasMatchingSceneContent<T extends Scene['type']>(
  scene: Scene,
  type: T,
): scene is SceneRendererScene<T> {
  return scene.type === type && scene.content.type === type;
}

function renderScene(scene: Scene, mode: StageMode): ReactNode {
  switch (scene.type) {
    case 'slide':
      if (!hasMatchingSceneContent(scene, 'slide')) return <div>Invalid slide content</div>;
      return <SlideRenderer mode={mode} />;
    case 'quiz':
      if (!hasMatchingSceneContent(scene, 'quiz')) return <div>Invalid quiz content</div>;
      return <QuizView key={scene.id} questions={scene.content.questions} sceneId={scene.id} />;
    case 'interactive':
      if (!hasMatchingSceneContent(scene, 'interactive')) {
        return <div>Invalid interactive content</div>;
      }
      return <InteractiveRenderer content={scene.content} mode={mode} sceneId={scene.id} />;
    case 'pbl':
      if (!hasMatchingSceneContent(scene, 'pbl')) return <div>Invalid PBL content</div>;
      return <PBLRenderer content={scene.content} mode={mode} sceneId={scene.id} />;
    default: {
      return <div>Unknown scene type</div>;
    }
  }
}

export function SceneRenderer({ scene, mode }: SceneRendererProps) {
  const renderer = useMemo(() => renderScene(scene, mode), [scene, mode]);

  return <div className="w-full h-full">{renderer}</div>;
}
