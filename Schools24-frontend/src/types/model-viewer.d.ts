/**
 * Type declarations for the <model-viewer> web component from @google/model-viewer.
 * This lets TypeScript / JSX understand the custom element without runtime errors.
 *
 * Reference: https://modelviewer.dev/docs/index.html
 */

declare namespace React.JSX {
  interface IntrinsicElements {
    "model-viewer": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    > & {
      /** URL to a 3D model (.glb / .gltf) */
      src?: string;
      /** Alt text for accessibility */
      alt?: string;
      /** Poster / loading image URL */
      poster?: string;
      /** Enable orbit / pan / zoom camera controls */
      "camera-controls"?: string;
      /** Auto-rotate the model */
      "auto-rotate"?: string;
      /** Auto-rotate delay in ms */
      "auto-rotate-delay"?: string;
      /** Shadow intensity 0-1 */
      "shadow-intensity"?: string;
      /** Shadow softness 0-1 */
      "shadow-softness"?: string;
      /** Environment image URL for lighting */
      "environment-image"?: string;
      /** Exposure value */
      exposure?: string;
      /** Enable AR on supported devices */
      ar?: string;
      /** AR modes */
      "ar-modes"?: string;
      /** Loading strategy: auto | lazy | eager */
      loading?: "auto" | "lazy" | "eager";
      /** Reveal strategy: auto | manual | interaction */
      reveal?: "auto" | "manual" | "interaction";
      /** Touch / interaction prompt: auto | none */
      "interaction-prompt"?: "auto" | "none";
      /** Camera orbit (theta phi radius) */
      "camera-orbit"?: string;
      /** Min camera orbit */
      "min-camera-orbit"?: string;
      /** Max camera orbit */
      "max-camera-orbit"?: string;
      /** Field of view */
      "field-of-view"?: string;
      /** Tone mapping: commerce | neutral */
      "tone-mapping"?: string;
      /** Slot children */
      children?: React.ReactNode;
    };
  }
}
