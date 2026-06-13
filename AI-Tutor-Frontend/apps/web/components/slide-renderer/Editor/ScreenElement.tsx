'use client';

import { ElementTypes, type PPTElement } from '@/lib/types/slides';
import { useMemo, useEffect, useRef } from 'react';
import { useAnimate } from 'motion/react';

import { BaseImageElement } from '../components/element/ImageElement/BaseImageElement';
import { BaseTextElement } from '../components/element/TextElement/BaseTextElement';
import { BaseShapeElement } from '../components/element/ShapeElement/BaseShapeElement';
import { BaseLineElement } from '../components/element/LineElement/BaseLineElement';
import { BaseChartElement } from '../components/element/ChartElement/BaseChartElement';
import { BaseLatexElement } from '../components/element/LatexElement/BaseLatexElement';
import { BaseTableElement } from '../components/element/TableElement/BaseTableElement';
import { BaseVideoElement } from '../components/element/VideoElement/BaseVideoElement';
import { BaseSvgElement } from '../components/element/SvgElement/BaseSvgElement';
import { BaseAudioElement } from '../components/element/AudioElement/BaseAudioElement';
import { useSceneSelector } from '@/lib/contexts/scene-context';
import type { SceneContent } from '@/lib/types/stage';
import type { AnimationInfo } from '@/lib/store/canvas';

interface ScreenElementProps {
  readonly elementInfo: PPTElement;
  readonly elementIndex: number;
  readonly animationEffect: AnimationInfo | null;
}

const animationVariants: Record<string, { initial: Record<string, number | string>; animate: Record<string, any> }> = {
  fadeIn: { initial: { opacity: 0 }, animate: { opacity: 1 } },
  fadeOut: { initial: { opacity: 1 }, animate: { opacity: 0 } },
  slideInLeft: { initial: { x: -60, opacity: 0 }, animate: { x: 0, opacity: 1 } },
  slideInRight: { initial: { x: 60, opacity: 0 }, animate: { x: 0, opacity: 1 } },
  slideInUp: { initial: { y: 60, opacity: 0 }, animate: { y: 0, opacity: 1 } },
  slideInDown: { initial: { y: -60, opacity: 0 }, animate: { y: 0, opacity: 1 } },
  bounce: { initial: {}, animate: { scale: [1, 1.15, 0.95, 1.05, 1] } },
  pulse: { initial: {}, animate: { scale: [1, 1.05, 1] } },
  shake: { initial: {}, animate: { x: [0, -5, 5, -5, 5, -3, 3, 0] } },
};

export function ScreenElement({ elementInfo, elementIndex, animationEffect }: ScreenElementProps) {
  const [scope, animate] = useAnimate();
  const prevEffectRef = useRef<string | null>(null);

  const type = elementInfo.type ?? (elementInfo as any).kind;

  const CurrentElementComponent = useMemo(() => {
    const elementTypeMap: Record<string, any> = {
      [ElementTypes.IMAGE]: BaseImageElement,
      [ElementTypes.TEXT]: BaseTextElement,
      [ElementTypes.SHAPE]: BaseShapeElement,
      [ElementTypes.LINE]: BaseLineElement,
      [ElementTypes.CHART]: BaseChartElement,
      [ElementTypes.LATEX]: BaseLatexElement,
      [ElementTypes.TABLE]: BaseTableElement,
      [ElementTypes.VIDEO]: BaseVideoElement,
      [ElementTypes.SVG]: BaseSvgElement,
      [ElementTypes.AUDIO]: BaseAudioElement,
    };
    return elementTypeMap[type] || null;
  }, [type]);

  const theme = useSceneSelector<SceneContent, { fontColor: string; fontName: string }>(
    (content) => {
      if (content.type === 'slide') {
        return content.canvas.theme;
      }
      return {
        fontColor: '#333333',
        fontName: 'Microsoft YaHei',
      };
    },
  );

  // Trigger animation when animationEffect changes
  useEffect(() => {
    if (!animationEffect) return;
    const effect = animationEffect.effect;
    if (effect === prevEffectRef.current) return;
    prevEffectRef.current = effect;

    const variants = animationVariants[effect];
    if (!variants) return;

    const duration = animationEffect.duration / 1000;

    if (Object.keys(variants.initial).length > 0) {
      animate(scope.current, variants.initial, { duration: 0 }).then(() => {
        animate(scope.current, variants.animate, { duration });
      });
    } else {
      animate(scope.current, variants.animate, { duration });
    }
  }, [animationEffect, animate, scope]);

  if (!CurrentElementComponent) {
    console.warn(`[ScreenElement] Unknown element type: ${type}`, elementInfo);
    return null;
  }

  return (
    <div
      ref={scope}
      className="screen-element"
      id={`screen-element-${elementInfo.id}`}
      style={{
        position: 'relative',
        zIndex: elementIndex,
        color: theme.fontColor,
        fontFamily: theme.fontName,
      }}
    >
      <CurrentElementComponent elementInfo={elementInfo} animate={!!animationEffect} />
    </div>
  );
}
