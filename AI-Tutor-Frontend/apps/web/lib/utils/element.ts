import tinycolor from 'tinycolor2';
import { nanoid } from 'nanoid';
import type { PPTElement, PPTLineElement, Slide } from '@/lib/types/slides';

interface RotatedElementData {
  left: number;
  top: number;
  width: number;
  height: number;
  rotate: number;
}

interface IdMap {
  [id: string]: string;
}

/**
 * Calculate the new position range of an element's bounding rectangle after rotation
 * @param element Element position, size, and rotation angle
 */
export const getRectRotatedRange = (element: RotatedElementData) => {
  const { left, top, width, height, rotate = 0 } = element;

  const radius = Math.sqrt(Math.pow(width, 2) + Math.pow(height, 2)) / 2;
  const auxiliaryAngle = (Math.atan(height / width) * 180) / Math.PI;

  const tlbraRadian = ((180 - rotate - auxiliaryAngle) * Math.PI) / 180;
  const trblaRadian = ((auxiliaryAngle - rotate) * Math.PI) / 180;

  const middleLeft = left + width / 2;
  const middleTop = top + height / 2;

  const xAxis = [
    middleLeft + radius * Math.cos(tlbraRadian),
    middleLeft + radius * Math.cos(trblaRadian),
    middleLeft - radius * Math.cos(tlbraRadian),
    middleLeft - radius * Math.cos(trblaRadian),
  ];
  const yAxis = [
    middleTop - radius * Math.sin(tlbraRadian),
    middleTop - radius * Math.sin(trblaRadian),
    middleTop + radius * Math.sin(tlbraRadian),
    middleTop + radius * Math.sin(trblaRadian),
  ];

  return {
    xRange: [Math.min(...xAxis), Math.max(...xAxis)],
    yRange: [Math.min(...yAxis), Math.max(...yAxis)],
  };
};

/**
 * Calculate the deviation distance between the rotated and original positions of an element
 * @param element Element position, size, and rotation angle
 */
export const getRectRotatedOffset = (element: RotatedElementData) => {
  const { xRange: originXRange, yRange: originYRange } = getRectRotatedRange({
    left: element.left,
    top: element.top,
    width: element.width,
    height: element.height,
    rotate: 0,
  });
  const { xRange: rotatedXRange, yRange: rotatedYRange } = getRectRotatedRange({
    left: element.left,
    top: element.top,
    width: element.width,
    height: element.height,
    rotate: element.rotate,
  });
  return {
    offsetX: rotatedXRange[0] - originXRange[0],
    offsetY: rotatedYRange[0] - originYRange[0],
  };
};

/**
 * Calculate the position range of an element on the canvas
 * @param element Element information
 */
export const getElementRange = (element: PPTElement) => {
  let minX, maxX, minY, maxY;

  if (element.type === 'line') {
    minX = element.left;
    maxX = element.left + Math.max(element.start[0], element.end[0]);
    minY = element.top;
    maxY = element.top + Math.max(element.start[1], element.end[1]);
  } else if ('rotate' in element && element.rotate) {
    const { left, top, width, height, rotate } = element;
    const { xRange, yRange } = getRectRotatedRange({
      left,
      top,
      width,
      height,
      rotate,
    });
    minX = xRange[0];
    maxX = xRange[1];
    minY = yRange[0];
    maxY = yRange[1];
  } else {
    minX = element.left;
    maxX = element.left + element.width;
    minY = element.top;
    maxY = element.top + element.height;
  }
  return { minX, maxX, minY, maxY };
};

/**
 * Calculate the position range of a group of elements on the canvas
 * @param elementList List of element information
 */
export const getElementListRange = (elementList: PPTElement[]) => {
  const leftValues: number[] = [];
  const topValues: number[] = [];
  const rightValues: number[] = [];
  const bottomValues: number[] = [];

  elementList.forEach((element) => {
    const { minX, maxX, minY, maxY } = getElementRange(element);
    leftValues.push(minX);
    topValues.push(minY);
    rightValues.push(maxX);
    bottomValues.push(maxY);
  });

  const minX = Math.min(...leftValues);
  const maxX = Math.max(...rightValues);
  const minY = Math.min(...topValues);
  const maxY = Math.max(...bottomValues);

  return { minX, maxX, minY, maxY };
};

/**
 * Calculate the length of a line element
 * @param element Line element
 */
export const getLineElementLength = (element: PPTLineElement) => {
  const deltaX = element.end[0] - element.start[0];
  const deltaY = element.end[1] - element.start[1];
  const len = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  return len;
};

export interface AlignLine {
  value: number;
  range: [number, number];
}

/**
 * Deduplicate alignment lines: keep only one line at each position, merge min/max ranges
 * @param lines Alignment line information
 */
export const uniqAlignLines = (lines: AlignLine[]) => {
  const uniqLines: AlignLine[] = [];
  lines.forEach((line) => {
    const index = uniqLines.findIndex((_line) => _line.value === line.value);
    if (index === -1) uniqLines.push(line);
    else {
      const uniqLine = uniqLines[index];
      const rangeMin = Math.min(uniqLine.range[0], line.range[0]);
      const rangeMax = Math.max(uniqLine.range[1], line.range[1]);
      const range: [number, number] = [rangeMin, rangeMax];
      const _line = { value: line.value, range };
      uniqLines[index] = _line;
    }
  });
  return uniqLines;
};

/**
 * Create a map of old-to-new IDs for all slides
 * Used when duplicating slides to preserve cross-references
 * @param slides Slide list
 */
export const createSlideIdMap = (slides: Slide[]) => {
  const slideIdMap: IdMap = {};
  for (const slide of slides) {
    slideIdMap[slide.id] = nanoid(10);
  }
  return slideIdMap;
};

/**
 * Create a map of old-to-new IDs for all elements
 * Used when duplicating elements to preserve cross-references
 * e.g. two grouped elements share a groupId — after duplication they share a new groupId
 * @param elements Element list
 */
export const createElementIdMap = (elements: PPTElement[]) => {
  const groupIdMap: IdMap = {};
  const elIdMap: IdMap = {};
  for (const element of elements) {
    const groupId = element.groupId;
    if (groupId && !groupIdMap[groupId]) {
      groupIdMap[groupId] = nanoid(10);
    }
    elIdMap[element.id] = nanoid(10);
  }
  return {
    groupIdMap,
    elIdMap,
  };
};

/**
 * Get the child color for a table based on its theme color
 * @param themeColor Theme color
 */
export const getTableSubThemeColor = (themeColor: string) => {
  const rgba = tinycolor(themeColor);
  return [rgba.setAlpha(0.3).toRgbString(), rgba.setAlpha(0.1).toRgbString()];
};

/**
 * Get the SVG path string for a line element
 * @param element Line element
 */
export const getLineElementPath = (element: PPTLineElement) => {
  // Defensive: ensure start and end are arrays
  const startArr = Array.isArray(element.start) ? element.start : [0, 0];
  const endArr = Array.isArray(element.end) ? element.end : [100, 100];
  const start = startArr.join(',');
  const end = endArr.join(',');
  if (element.broken) {
    const mid = element.broken.join(',');
    return `M${start} L${mid} L${end}`;
  } else if (element.broken2) {
    const { minX, maxX, minY, maxY } = getElementRange(element);
    if (maxX - minX >= maxY - minY)
      return `M${start} L${element.broken2[0]},${startArr[1]} L${element.broken2[0]},${endArr[1]} ${end}`;
    return `M${start} L${startArr[0]},${element.broken2[1]} L${endArr[0]},${element.broken2[1]} ${end}`;
  } else if (element.curve) {
    const mid = element.curve.join(',');
    return `M${start} Q${mid} ${end}`;
  } else if (element.cubic) {
    const [c1, c2] = element.cubic;
    const p1 = c1.join(',');
    const p2 = c2.join(',');
    return `M${start} C${p1} ${p2} ${end}`;
  }
  return `M${start} L${end}`;
};

/**
 * Check whether an element is within the visible viewport
 * @param element Element
 * @param parent Parent element
 */
export const isElementInViewport = (element: HTMLElement, parent: HTMLElement): boolean => {
  const elementRect = element.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();

  return elementRect.top >= parentRect.top && elementRect.bottom <= parentRect.bottom;
};
