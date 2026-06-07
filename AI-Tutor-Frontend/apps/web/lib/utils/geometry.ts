import type { PPTElement } from '@/lib/types/slides';
import type { PercentageGeometry } from '@/lib/types/action';

/**
 * Calculate percentage coordinates (0-100) for an element
 *
 * @param element - PPT element
 * @param viewportSize - Viewport width base, default 1000px
 * @param viewportRatio - Viewport height/width ratio, default 0.5625 (16:9)
 * @returns Percentage geometry info, or null if the element has no position info
 */
export function getElementPercentageGeometry(
  element: PPTElement,
  viewportSize: number = 1000,
  viewportRatio: number = 0.5625,
): PercentageGeometry | null {
  // Only positioned elements have left/top/width/height
  if (
    !('left' in element) ||
    !('top' in element) ||
    !('width' in element) ||
    !('height' in element)
  ) {
    return null;
  }

  const { left, top, width, height } = element;
  const viewportHeight = viewportSize * viewportRatio;

  // Calculate percentage coordinates (relative to actual viewport dimensions)
  const x = (left / viewportSize) * 100;
  const y = (top / viewportHeight) * 100;
  const w = (width / viewportSize) * 100;
  const h = (height / viewportHeight) * 100;

  // Calculate center point
  const centerX = x + w / 2;
  const centerY = y + h / 2;

  return {
    x,
    y,
    w,
    h,
    centerX,
    centerY,
  };
}

/**
 * Find percentage geometry info by scene and element ID
 *
 * @param scene - Scene object
 * @param elementId - Element ID
 * @returns Percentage geometry info, or null if element is not found or has no position info
 */
export function findElementGeometry(
  scene: Record<string, any>,
  elementId: string,
): PercentageGeometry | null {
  // Support two scene structures:
  // 1. scene.elements (old format)
  // 2. scene.content.canvas.elements (new format)
  let elements: PPTElement[] | undefined;
  let viewportSize = 1000;
  let viewportRatio = 0.5625;

  if (scene.type === 'slide') {
    if (scene.elements) {
      // Old format
      elements = scene.elements;
    } else if (scene.content?.canvas?.elements) {
      // New format
      const canvas = scene.content.canvas;
      elements = canvas.elements;
      viewportSize = canvas.viewportSize ?? canvas.viewport_width ?? 1000;
      viewportRatio = canvas.viewportRatio ?? canvas.viewport_ratio ?? 0.5625;
    }
  }

  if (!elements) {
    return null;
  }

  const element = elements.find((el: PPTElement) => el.id === elementId);
  if (!element) {
    return null;
  }

  return getElementPercentageGeometry(element, viewportSize, viewportRatio);
}

/**
 * Calculate which corner has the shortest distance to the element center
 *
 * @param geometry - Percentage geometry info
 * @returns Nearest corner coordinates { x: 0-100, y: 0-100 }
 */
export function findNearestCorner(geometry: PercentageGeometry): {
  x: number;
  y: number;
} {
  const { centerX, centerY } = geometry;

  // Coordinates of the four corners
  const corners = [
    { x: 0, y: 0 }, // Top-left
    { x: 100, y: 0 }, // Top-right
    { x: 0, y: 100 }, // Bottom-left
    { x: 100, y: 100 }, // Bottom-right
  ];

  // Calculate distances and find the nearest corner
  let minDistance = Infinity;
  let nearestCorner = corners[0];

  for (const corner of corners) {
    const distance = Math.sqrt(Math.pow(corner.x - centerX, 2) + Math.pow(corner.y - centerY, 2));
    if (distance < minDistance) {
      minDistance = distance;
      nearestCorner = corner;
    }
  }

  return nearestCorner;
}
