export const enum ShapePathFormulasKeys {
  ROUND_RECT = 'roundRect',
  ROUND_RECT_DIAGONAL = 'roundRectDiagonal',
  ROUND_RECT_SINGLE = 'roundRectSingle',
  ROUND_RECT_SAMESIDE = 'roundRectSameSide',
  CUT_RECT_DIAGONAL = 'cutRectDiagonal',
  CUT_RECT_SINGLE = 'cutRectSingle',
  CUT_RECT_SAMESIDE = 'cutRectSameSide',
  CUT_ROUND_RECT = 'cutRoundRect',
  MESSAGE = 'message',
  ROUND_MESSAGE = 'roundMessage',
  L = 'L',
  RING_RECT = 'ringRect',
  PLUS = 'plus',
  TRIANGLE = 'triangle',
  PARALLELOGRAM_LEFT = 'parallelogramLeft',
  PARALLELOGRAM_RIGHT = 'parallelogramRight',
  TRAPEZOID = 'trapezoid',
  BULLET = 'bullet',
  INDICATOR = 'indicator',
  DONUT = 'donut',
  DIAGSTRIPE = 'diagStripe',
}

export const enum ElementTypes {
  TEXT = 'text',
  IMAGE = 'image',
  SHAPE = 'shape',
  LINE = 'line',
  CHART = 'chart',
  TABLE = 'table',
  LATEX = 'latex',
  VIDEO = 'video',
  AUDIO = 'audio',
}

/**
 * Gradient
 *
 * type: gradient type (radial, linear)
 *
 * colors: gradient color list (pos: percentage position; color: color value)
 *
 * rotate: gradient angle (linear gradient)
 */
export type GradientType = 'linear' | 'radial';
export type GradientColor = {
  pos: number;
  color: string;
};
export interface Gradient {
  type: GradientType;
  colors: GradientColor[];
  rotate: number;
}

export type LineStyleType = 'solid' | 'dashed' | 'dotted';

/**
 * Element shadow
 *
 * h: horizontal offset
 *
 * v: vertical offset
 *
 * blur: blur amount
 *
 * color: shadow color
 */
export interface PPTElementShadow {
  h: number;
  v: number;
  blur: number;
  color: string;
}

/**
 * Element outline
 *
 * style?: line style (solid or dashed)
 *
 * width?: border width
 *
 * color?: border color
 */
export interface PPTElementOutline {
  style?: LineStyleType;
  width?: number;
  color?: string;
}

export type ElementLinkType = 'web' | 'slide';

/**
 * Element hyperlink
 *
 * type: link type (web page, slide page)
 *
 * target: target address (web URL, slide page ID)
 */
export interface PPTElementLink {
  type: ElementLinkType;
  target: string;
}

/**
 * Element common properties
 *
 * id: element ID
 *
 * left: horizontal position (distance from canvas left edge)
 *
 * top: vertical position (distance from canvas top edge)
 *
 * lock?: lock element
 *
 * groupId?: group ID (elements sharing the same groupId are members of the same group)
 *
 * width: element width
 *
 * height: element height
 *
 * rotate: rotation angle
 *
 * link?: hyperlink
 *
 * name?: element name
 */
interface PPTBaseElement {
  id: string;
  left: number;
  top: number;
  lock?: boolean;
  groupId?: string;
  width: number;
  height: number;
  rotate: number;
  link?: PPTElementLink;
  name?: string;
}

export type TextType =
  | 'title'
  | 'subtitle'
  | 'content'
  | 'item'
  | 'itemTitle'
  | 'notes'
  | 'header'
  | 'footer'
  | 'partNumber'
  | 'itemNumber';

/**
 * Text element
 *
 * type: element type (text)
 *
 * content: text content (HTML string)
 *
 * defaultFontName: default font (can be overridden by HTML inline styles in content)
 *
 * defaultColor: default color (can be overridden by HTML inline styles in content)
 *
 * outline?: border
 *
 * fill?: fill color
 *
 * lineHeight?: line height (multiple), default 1.5
 *
 * wordSpace?: word spacing, default 0
 *
 * opacity?: opacity, default 1
 *
 * shadow?: shadow
 *
 * paragraphSpace?: paragraph spacing, default 5px
 *
 * vertical?: vertical text
 *
 * textType?: text type
 */
export interface PPTTextElement extends PPTBaseElement {
  type: 'text';
  content: string;
  defaultFontName: string;
  defaultColor: string;
  outline?: PPTElementOutline;
  fill?: string;
  lineHeight?: number;
  wordSpace?: number;
  opacity?: number;
  shadow?: PPTElementShadow;
  paragraphSpace?: number;
  vertical?: boolean;
  textType?: TextType;
}

/**
 * Image flip, shape flip
 *
 * flipH?: horizontal flip
 *
 * flipV?: vertical flip
 */
export interface ImageOrShapeFlip {
  flipH?: boolean;
  flipV?: boolean;
}

/**
 * Image filters
 *
 * https://developer.mozilla.org/en-US/docs/Web/CSS/filter
 *
 * 'blur'?: blur, default 0 (px)
 *
 * 'brightness'?: brightness, default 100 (%)
 *
 * 'contrast'?: contrast, default 100 (%)
 *
 * 'grayscale'?: grayscale, default 0 (%)
 *
 * 'saturate'?: saturation, default 100 (%)
 *
 * 'hue-rotate'?: hue rotation, default 0 (deg)
 *
 * 'opacity'?: opacity, default 100 (%)
 */
export type ImageElementFilterKeys =
  | 'blur'
  | 'brightness'
  | 'contrast'
  | 'grayscale'
  | 'saturate'
  | 'hue-rotate'
  | 'opacity'
  | 'sepia'
  | 'invert';
export interface ImageElementFilters {
  blur?: string;
  brightness?: string;
  contrast?: string;
  grayscale?: string;
  saturate?: string;
  'hue-rotate'?: string;
  sepia?: string;
  invert?: string;
  opacity?: string;
}

export type ImageClipDataRange = [[number, number], [number, number]];

/**
 * Image clip
 *
 * range: clip range, e.g. [[10, 10], [90, 90]] means cropping from top-left 10%, 10% to 90%, 90%
 *
 * shape: clip shape, see configs/image-clip.ts CLIPPATHS
 */
export interface ImageElementClip {
  range: ImageClipDataRange;
  shape: string;
}

export type ImageType = 'pageFigure' | 'itemFigure' | 'background';

/**
 * Image element
 *
 * type: element type (image)
 *
 * fixedRatio: lock image aspect ratio
 *
 * src: image URL
 *
 * outline?: border
 *
 * filters?: image filters
 *
 * clip?: clip info
 *
 * flipH?: horizontal flip
 *
 * flipV?: vertical flip
 *
 * shadow?: shadow
 *
 * radius?: border radius
 *
 * colorMask?: color mask
 *
 * imageType?: image type
 */
export interface PPTImageElement extends PPTBaseElement {
  type: 'image';
  fixedRatio: boolean;
  src: string;
  outline?: PPTElementOutline;
  filters?: ImageElementFilters;
  clip?: ImageElementClip;
  flipH?: boolean;
  flipV?: boolean;
  shadow?: PPTElementShadow;
  radius?: number;
  colorMask?: string;
  imageType?: ImageType;
}

export type ShapeTextAlign = 'top' | 'middle' | 'bottom';

/**
 * Shape text
 *
 * content: text content (HTML string)
 *
 * defaultFontName: default font (can be overridden by HTML inline styles in content)
 *
 * defaultColor: default color (can be overridden by HTML inline styles in content)
 *
 * align: text alignment (vertical direction)
 *
 * lineHeight?: line height (multiple), default 1.5
 *
 * wordSpace?: word spacing, default 0
 *
 * paragraphSpace?: paragraph spacing, default 5px
 *
 * type: text type
 */
export interface ShapeText {
  content: string;
  defaultFontName: string;
  defaultColor: string;
  align: ShapeTextAlign;
  lineHeight?: number;
  wordSpace?: number;
  paragraphSpace?: number;
  type?: TextType;
}

/**
 * Shape element
 *
 * type: element type (shape)
 *
 * viewBox: SVG viewBox attribute, e.g. [1000, 1000] means '0 0 1000 1000'
 *
 * path: shape path, SVG path d attribute
 *
 * fixedRatio: lock shape aspect ratio
 *
 * fill: fill color (used when gradient is not set)
 *
 * gradient?: gradient, takes priority over fill when present
 *
 * pattern?: pattern, takes priority over fill when present
 *
 * outline?: border
 *
 * opacity?: opacity
 *
 * flipH?: horizontal flip
 *
 * flipV?: vertical flip
 *
 * shadow?: shadow
 *
 * special?: special shape (marks shapes that are hard to parse, e.g. paths using types other than L Q C A; these shapes will be exported as images)
 *
 * text?: text inside shape
 *
 * pathFormula?: shape path formula
 *   Normally when a shape is resized, only width/height are adjusted via the viewBox scale ratio,
 *   while viewBox and path remain unchanged. Some shapes need more precise control over key points,
 *   so a path formula is used to recalculate the path when scaling by updating viewBox.
 *
 * keypoints?: key point position percentages
 */
export interface PPTShapeElement extends PPTBaseElement {
  type: 'shape';
  viewBox: [number, number];
  path: string;
  fixedRatio: boolean;
  fill: string;
  gradient?: Gradient;
  pattern?: string;
  outline?: PPTElementOutline;
  opacity?: number;
  flipH?: boolean;
  flipV?: boolean;
  shadow?: PPTElementShadow;
  special?: boolean;
  text?: ShapeText;
  pathFormula?: ShapePathFormulasKeys;
  keypoints?: number[];
}

export type LinePoint = '' | 'arrow' | 'dot';

/**
 * Line element
 *
 * type: element type (line)
 *
 * start: start position ([x, y])
 *
 * end: end position ([x, y])
 *
 * style: line style (solid, dashed, dotted)
 *
 * color: line color
 *
 * points: endpoint styles ([start style, end style], options: none, arrow, dot)
 *
 * shadow?: shadow
 *
 * broken?: polyline control point position ([x, y])
 *
 * broken2?: double polyline control point position ([x, y])
 *
 * curve?: quadratic curve control point position ([x, y])
 *
 * cubic?: cubic curve control point positions ([[x1, y1], [x2, y2]])
 */
export interface PPTLineElement extends Omit<PPTBaseElement, 'height' | 'rotate'> {
  type: 'line';
  start: [number, number];
  end: [number, number];
  style: LineStyleType;
  color: string;
  points: [LinePoint, LinePoint];
  shadow?: PPTElementShadow;
  broken?: [number, number];
  broken2?: [number, number];
  curve?: [number, number];
  cubic?: [[number, number], [number, number]];
}

export type ChartType = 'bar' | 'column' | 'line' | 'pie' | 'ring' | 'area' | 'radar' | 'scatter';

export interface ChartOptions {
  lineSmooth?: boolean;
  stack?: boolean;
}

export interface ChartData {
  labels: string[];
  legends: string[];
  series: number[][];
}

/**
 * Chart element
 *
 * type: element type (chart)
 *
 * fill?: fill color
 *
 * chartType: base chart type (bar/line/pie), all chart types derive from these three
 *
 * data: chart data
 *
 * options: extension options
 *
 * outline?: border
 *
 * themeColors: theme colors
 *
 * textColor?: axis and label color
 *
 * lineColor?: grid color
 */
export interface PPTChartElement extends PPTBaseElement {
  type: 'chart';
  fill?: string;
  chartType: ChartType;
  data: ChartData;
  options?: ChartOptions;
  outline?: PPTElementOutline;
  themeColors: string[];
  textColor?: string;
  lineColor?: string;
}

export type TextAlign = 'left' | 'center' | 'right' | 'justify';
/**
 * Table cell style
 *
 * bold?: bold
 *
 * em?: italic
 *
 * underline?: underline
 *
 * strikethrough?: strikethrough
 *
 * color?: font color
 *
 * backcolor?: fill color
 *
 * fontsize?: font size
 *
 * fontname?: font name
 *
 * align?: alignment
 */
export interface TableCellStyle {
  bold?: boolean;
  em?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  backcolor?: string;
  fontsize?: string;
  fontname?: string;
  align?: TextAlign;
}

/**
 * Table cell
 *
 * id: cell ID
 *
 * colspan: number of columns to merge
 *
 * rowspan: number of rows to merge
 *
 * text: text content
 *
 * style?: cell style
 */
export interface TableCell {
  id: string;
  colspan: number;
  rowspan: number;
  text: string;
  style?: TableCellStyle;
}

/**
 * Table theme
 *
 * color: theme color
 *
 * rowHeader: header row
 *
 * rowFooter: footer row
 *
 * colHeader: first column
 *
 * colFooter: last column
 */
export interface TableTheme {
  color: string;
  rowHeader: boolean;
  rowFooter: boolean;
  colHeader: boolean;
  colFooter: boolean;
}

/**
 * Table element
 *
 * type: element type (table)
 *
 * outline: border
 *
 * theme?: theme
 *
 * colWidths: column widths array, e.g. [0.3, 0.5, 0.2] means three columns at 30%, 50%, 20% of total width
 *
 * cellMinHeight: minimum cell height
 *
 * data: table data
 */
export interface PPTTableElement extends PPTBaseElement {
  type: 'table';
  outline: PPTElementOutline;
  theme?: TableTheme;
  colWidths: number[];
  cellMinHeight: number;
  data: TableCell[][];
}

/**
 * LaTeX element (formula)
 *
 * type: element type (latex)
 *
 * latex: LaTeX code
 *
 * html: KaTeX rendered HTML string (used by new formula rendering)
 *
 * path: SVG path (legacy SVG rendering, backward compatible, optional)
 *
 * color: color (legacy SVG rendering, backward compatible, optional)
 *
 * strokeWidth: path width (legacy SVG rendering, backward compatible, optional)
 *
 * viewBox: SVG viewBox attribute (legacy SVG rendering, backward compatible, optional)
 *
 * fixedRatio: lock aspect ratio (optional)
 *
 * align: horizontal alignment (left/center/right, default center)
 */
export interface PPTLatexElement extends PPTBaseElement {
  type: 'latex';
  latex: string;
  html?: string;
  path?: string;
  color?: string;
  strokeWidth?: number;
  viewBox?: [number, number];
  fixedRatio?: boolean;
  align?: 'left' | 'center' | 'right';
}

/**
 * Video element
 *
 * type: element type (video)
 *
 * src: video URL
 *
 * autoplay: autoplay
 *
 * poster: preview poster
 *
 * ext: video extension, used when the source URL lacks a file extension
 */
export interface PPTVideoElement extends PPTBaseElement {
  type: 'video';
  src: string;
  autoplay: boolean;
  poster?: string;
  ext?: string;
}

/**
 * Audio element
 *
 * type: element type (audio)
 *
 * fixedRatio: lock icon aspect ratio
 *
 * color: icon color
 *
 * loop: loop playback
 *
 * autoplay: autoplay
 *
 * src: audio URL
 *
 * ext: audio extension, used when the source URL lacks a file extension
 */
export interface PPTAudioElement extends PPTBaseElement {
  type: 'audio';
  fixedRatio: boolean;
  color: string;
  loop: boolean;
  autoplay: boolean;
  src: string;
  ext?: string;
}

export type PPTElement =
  | PPTTextElement
  | PPTImageElement
  | PPTShapeElement
  | PPTLineElement
  | PPTChartElement
  | PPTTableElement
  | PPTLatexElement
  | PPTVideoElement
  | PPTAudioElement;

export type AnimationType = 'in' | 'out' | 'attention';
export type AnimationTrigger = 'click' | 'meantime' | 'auto';

/**
 * Element animation
 *
 * id: animation ID
 *
 * elId: element ID
 *
 * effect: animation effect
 *
 * type: animation type (in, out, attention)
 *
 * duration: animation duration
 *
 * trigger: animation trigger (click - on click, meantime - with previous, auto - after previous)
 */
export interface PPTAnimation {
  id: string;
  elId: string;
  effect: string;
  type: AnimationType;
  duration: number;
  trigger: AnimationTrigger;
}

export type SlideBackgroundType = 'solid' | 'image' | 'gradient';
export type SlideBackgroundImageSize = 'cover' | 'contain' | 'repeat';
export interface SlideBackgroundImage {
  src: string;
  size: SlideBackgroundImageSize;
}

/**
 * Slide background
 *
 * type: background type (solid, image, gradient)
 *
 * color?: background color (solid)
 *
 * image?: image background
 *
 * gradientType?: gradient background
 */
export interface SlideBackground {
  type: SlideBackgroundType;
  color?: string;
  image?: SlideBackgroundImage;
  gradient?: Gradient;
}

export type TurningMode =
  | 'no'
  | 'fade'
  | 'slideX'
  | 'slideY'
  | 'random'
  | 'slideX3D'
  | 'slideY3D'
  | 'rotate'
  | 'scaleY'
  | 'scaleX'
  | 'scale'
  | 'scaleReverse';

export interface SectionTag {
  id: string;
  title?: string;
}

export type SlideType = 'cover' | 'contents' | 'transition' | 'content' | 'end';

/**
 * Slide page
 *
 * id: slide ID
 *
 * viewportSize: viewport size
 *
 * viewportRatio: viewport aspect ratio
 *
 * theme: slide theme
 *
 * elements: element collection
 *
 * background?: page background
 *
 * animations?: element animation collection
 *
 * turningMode?: page transition
 *
 * sectionTag?: section tag
 *
 * type?: slide type
 */
export interface Slide {
  id: string;
  viewportSize: number;
  viewportRatio: number;
  theme: SlideTheme;
  elements: PPTElement[];
  background?: SlideBackground;
  animations?: PPTAnimation[];
  turningMode?: TurningMode;
  sectionTag?: SectionTag;
  type?: SlideType;
}

/**
 * Slide theme
 *
 * backgroundColor: page background color
 *
 * themeColor: theme color, used for default shape colors etc.
 *
 * fontColor: font color
 *
 * fontName: font name
 */
export interface SlideTheme {
  backgroundColor: string;
  themeColors: string[];
  fontColor: string;
  fontName: string;
  outline?: PPTElementOutline;
  shadow?: PPTElementShadow;
}

export interface SlideTemplate {
  name: string;
  id: string;
  cover: string;
  origin?: string;
}

/**
 * @deprecated SlideData is deprecated, use Slide instead
 */
export interface SlideData {
  id: string;
  viewportSize: number;
  viewportRatio: number;
  theme: {
    themeColors: string[];
    fontColor: string;
    fontName: string;
    backgroundColor: string;
  };
  elements: PPTElement[];
  background?: SlideBackground;
  animations?: unknown[];
}
