"use client";

import { useEffect, useRef, forwardRef, useImperativeHandle, useState, useCallback, useMemo } from "react";
import type { LessonAction } from "@ai-tutor/types";

export type WhiteboardCanvasProps = {
  elements: LessonAction[];
  isClearing: boolean;
  onViewModifiedChange?: (modified: boolean) => void;
};

export type WhiteboardCanvasHandle = {
  resetView: () => void;
};

export const WhiteboardCanvas = forwardRef<WhiteboardCanvasHandle, WhiteboardCanvasProps>(
  function WhiteboardCanvas({ elements, isClearing, onViewModifiedChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const [viewZoom, setViewZoom] = useState(1);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const [isPanning, setIsPanning] = useState(false);
    const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

    const canvasWidth = 1000;
    const canvasHeight = 562.5;

    const containerScale = useMemo(() => {
      if (containerSize.width === 0 || containerSize.height === 0) return 1;
      return Math.min(containerSize.width / canvasWidth, containerSize.height / canvasHeight);
    }, [containerSize.width, containerSize.height]);

    // Handle container resize
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          setContainerSize({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      });
      observer.observe(container);

      setContainerSize({ width: container.clientWidth, height: container.clientHeight });

      return () => observer.disconnect();
    }, []);

    const resetView = useCallback(() => {
      setViewZoom(1);
      setPanX(0);
      setPanY(0);
      onViewModifiedChange?.(false);
    }, [onViewModifiedChange]);

    useImperativeHandle(ref, () => ({ resetView }), [resetView]);

    // Pan interaction
    const handlePointerDown = useCallback(
      (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        setIsPanning(true);
        panStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      },
      [panX, panY]
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent) => {
        if (!isPanning) return;
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        const effectiveScale = Math.max(containerScale * viewZoom, 0.001);

        setPanX(panStartRef.current.panX + dx / effectiveScale);
        setPanY(panStartRef.current.panY + dy / effectiveScale);
        onViewModifiedChange?.(true);
      },
      [isPanning, containerScale, viewZoom, onViewModifiedChange]
    );

    const handlePointerUp = useCallback((e: React.PointerEvent) => {
      if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      }
      setIsPanning(false);
    }, []);

    // Draw elements
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Setup high-DPI canvas
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvasWidth * dpr;
      canvas.height = canvasHeight * dpr;
      
      // We apply standard scaling via CSS, but actual draw calls need dpr
      ctx.scale(dpr, dpr);

      // Clear canvas
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);

      if (isClearing) {
        // Simple clearing animation: draw with increasing blur/opacity
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        return;
      }

      // Draw all elements
      for (const el of elements) {
        ctx.save();

        if (el.type === "whiteboard_draw_text") {
          ctx.fillStyle = el.color || "#000000";
          ctx.font = `${el.font_size || 24}px sans-serif`;
          ctx.textBaseline = "top";
          // Basic text wrapping could be added here
          ctx.fillText(el.content, el.x, el.y);
        } else if (el.type === "whiteboard_draw_shape") {
          ctx.fillStyle = el.fill_color || "rgba(0,0,0,0.1)";
          ctx.strokeStyle = "#333333";
          ctx.lineWidth = 2;
          
          if (el.shape === "rectangle") {
            ctx.beginPath();
            ctx.rect(el.x, el.y, el.width, el.height);
            ctx.fill();
            ctx.stroke();
          } else if (el.shape === "circle") {
            ctx.beginPath();
            ctx.ellipse(el.x + el.width/2, el.y + el.height/2, el.width/2, el.height/2, 0, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
          } else if (el.shape === "triangle") {
            ctx.beginPath();
            ctx.moveTo(el.x + el.width/2, el.y);
            ctx.lineTo(el.x + el.width, el.y + el.height);
            ctx.lineTo(el.x, el.y + el.height);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
        } else if (el.type === "whiteboard_draw_line") {
          ctx.strokeStyle = el.color || "#000000";
          ctx.lineWidth = el.width || 2;
          if (el.style === "dashed") {
            ctx.setLineDash([5, 5]);
          }
          
          ctx.beginPath();
          ctx.moveTo(el.start_x, el.start_y);
          ctx.lineTo(el.end_x, el.end_y);
          ctx.stroke();

          // Arrowhead if points
          if (el.points && el.points[1] === "arrow") {
            const angle = Math.atan2(el.end_y - el.start_y, el.end_x - el.start_x);
            const headlen = 10;
            ctx.beginPath();
            ctx.moveTo(el.end_x, el.end_y);
            ctx.lineTo(el.end_x - headlen * Math.cos(angle - Math.PI / 6), el.end_y - headlen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(el.end_x, el.end_y);
            ctx.lineTo(el.end_x - headlen * Math.cos(angle + Math.PI / 6), el.end_y - headlen * Math.sin(angle + Math.PI / 6));
            ctx.stroke();
          }
        } else if (el.type === "whiteboard_draw_chart") {
          // Minimal purely-canvas chart
          ctx.fillStyle = "rgba(0,0,0,0.05)";
          ctx.fillRect(el.x, el.y, el.width, el.height);
          ctx.fillStyle = "#666";
          ctx.font = "14px sans-serif";
          ctx.fillText(`Chart: ${el.chart_type}`, el.x + 10, el.y + 20);
          
          if (el.data && el.data.series && el.data.series[0]) {
             const series = el.data.series[0];
             const max = Math.max(...series, 1);
             const barWidth = el.width / (series.length * 2);
             
             ctx.fillStyle = el.theme_colors?.[0] || "#3b82f6";
             series.forEach((val, i) => {
               const h = (val / max) * (el.height - 40);
               ctx.fillRect(el.x + 10 + i * barWidth * 2, el.y + el.height - h - 10, barWidth, h);
             });
          }
        } else if (el.type === "whiteboard_draw_table") {
          ctx.strokeStyle = el.outline?.color || "#cccccc";
          ctx.lineWidth = el.outline?.width || 1;
          
          if (el.data && el.data.length > 0) {
            const rows = el.data.length;
            const cols = el.data[0].length;
            const cellW = el.width / cols;
            const cellH = el.height / rows;
            
            ctx.font = "14px sans-serif";
            ctx.fillStyle = el.theme?.color || "#000000";
            
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                const cellX = el.x + c * cellW;
                const cellY = el.y + r * cellH;
                ctx.strokeRect(cellX, cellY, cellW, cellH);
                ctx.textBaseline = "middle";
                ctx.fillText(el.data[r][c], cellX + 5, cellY + cellH/2);
              }
            }
          }
        } else if (el.type === "whiteboard_draw_latex") {
           // Basic fallback for KaTeX
           ctx.fillStyle = el.color || "#000000";
           ctx.font = "italic 20px serif";
           ctx.fillText(`Math: ${el.latex}`, el.x, el.y + 20);
        }

        ctx.restore();
      }
    }, [elements, isClearing]);

    const totalScale = containerScale * viewZoom;
    const canvasScreenX = (containerSize.width - canvasWidth * totalScale) / 2 + panX * totalScale;
    const canvasScreenY = (containerSize.height - canvasHeight * totalScale) / 2 + panY * totalScale;
    const canvasTransform = `translate(${canvasScreenX}px, ${canvasScreenY}px) scale(${totalScale})`;

    return (
      <div
        ref={containerRef}
        className="w-full h-full relative overflow-hidden bg-gray-50 dark:bg-gray-900 rounded-lg shadow-inner"
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={resetView}
      >
        <canvas
          ref={canvasRef}
          className="absolute bg-white shadow-lg border border-gray-200 dark:border-gray-700 pointer-events-none"
          style={{
            width: canvasWidth,
            height: canvasHeight,
            left: 0,
            top: 0,
            transform: canvasTransform,
            transformOrigin: '0 0',
          }}
        />

        {elements.length === 0 && !isClearing && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center text-gray-400">
              <p className="text-lg font-medium">Whiteboard Ready</p>
              <p className="text-sm mt-1">Agents can draw here during discussions.</p>
            </div>
          </div>
        )}
      </div>
    );
  }
);
