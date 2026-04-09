import { useCallback, useState } from "react";
import type { LessonAction, WhiteboardObject, WhiteboardSnapshot } from "@ai-tutor/types";

export type WhiteboardState = {
  isOpen: boolean;
  elements: LessonAction[];
  isClearing: boolean;
};

export function useWhiteboardState() {
  const [state, setState] = useState<WhiteboardState>({
    isOpen: false,
    elements: [],
    isClearing: false,
  });

  const clear = useCallback(async () => {
    setState((prev) => ({ ...prev, isClearing: true }));
    // Wait for exit animation
    await new Promise((resolve) => setTimeout(resolve, 400));
    setState((prev) => ({ ...prev, isClearing: false, elements: [] }));
  }, []);

  const executeAction = useCallback(
    async (action: LessonAction) => {
      switch (action.type) {
        case "whiteboard_open":
          setState((prev) => ({ ...prev, isOpen: true }));
          break;
        case "whiteboard_close":
          setState((prev) => ({ ...prev, isOpen: false }));
          break;
        case "whiteboard_clear":
          await clear();
          break;
        case "whiteboard_delete":
          setState((prev) => ({
            ...prev,
            elements: prev.elements.filter(
              (el) => !("element_id" in el) || el.element_id !== action.element_id
            ),
          }));
          break;
        case "whiteboard_draw_text":
        case "whiteboard_draw_shape":
        case "whiteboard_draw_chart":
        case "whiteboard_draw_latex":
        case "whiteboard_draw_table":
        case "whiteboard_draw_line":
          setState((prev) => {
            // Re-drawing the same element ID replaces it
            const existingIdx = prev.elements.findIndex(
              (el) =>
                "element_id" in el &&
                "element_id" in action &&
                el.element_id === action.element_id &&
                action.element_id != null
            );

            if (existingIdx >= 0) {
              const newElements = [...prev.elements];
              newElements[existingIdx] = action;
              return { ...prev, elements: newElements };
            }

            return { ...prev, elements: [...prev.elements, action] };
          });
          break;
      }
    },
    [clear]
  );

  const hydrateSnapshot = useCallback((snapshot: WhiteboardSnapshot | null | undefined) => {
    if (!snapshot) {
      return;
    }

    setState({
      isOpen: snapshot.is_open,
      isClearing: false,
      elements: snapshot.objects.map(mapSnapshotObjectToLessonAction),
    });
  }, []);

  return {
    state,
    executeAction,
    hydrateSnapshot,
    isOpen: state.isOpen,
    elements: state.elements,
    isClearing: state.isClearing,
  };
}

function mapSnapshotObjectToLessonAction(object: WhiteboardObject): LessonAction {
  switch (object.kind) {
    case "text":
      return {
        type: "whiteboard_draw_text",
        id: object.id,
        element_id: object.id,
        content: object.content,
        x: object.position.x,
        y: object.position.y,
        font_size: object.font_size,
        color: object.color,
      };
    case "rectangle":
      return {
        type: "whiteboard_draw_shape",
        id: object.id,
        element_id: object.id,
        shape: "rectangle",
        x: object.position.x,
        y: object.position.y,
        width: object.width,
        height: object.height,
        fill_color: object.fill ?? null,
      };
    case "circle":
      return {
        type: "whiteboard_draw_shape",
        id: object.id,
        element_id: object.id,
        shape: "circle",
        x: object.center.x - object.radius,
        y: object.center.y - object.radius,
        width: object.radius * 2,
        height: object.radius * 2,
        fill_color: object.fill ?? null,
      };
    case "highlight":
      return {
        type: "whiteboard_draw_shape",
        id: object.id,
        element_id: object.id,
        shape: "rectangle",
        x: object.position.x,
        y: object.position.y,
        width: object.width,
        height: object.height,
        fill_color: object.color,
      };
    case "arrow":
      return {
        type: "whiteboard_draw_line",
        id: object.id,
        element_id: object.id,
        start_x: object.start.x,
        start_y: object.start.y,
        end_x: object.end.x,
        end_y: object.end.y,
        color: object.color,
        width: object.stroke_width,
        style: "solid",
        points: ["start", "arrow"],
      };
    case "path": {
      const start = object.points[0] ?? { x: 0, y: 0 };
      const end = object.points[object.points.length - 1] ?? start;
      return {
        type: "whiteboard_draw_line",
        id: object.id,
        element_id: object.id,
        start_x: start.x,
        start_y: start.y,
        end_x: end.x,
        end_y: end.y,
        color: object.color,
        width: object.stroke_width,
        style: "solid",
        points: null,
      };
    }
  }
}
