"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { GenerateLessonPayload, GenerateLessonResponse } from "@ai-tutor/types";
import { Button, Panel, Pill } from "@ai-tutor/ui";

import { generateLesson } from "../lib/api";

const initialPayload: GenerateLessonPayload = {
  requirement: "",
  language: "en-US",
  enable_web_search: false,
  enable_image_generation: false,
  enable_video_generation: false,
  enable_tts: false,
  agent_mode: "default",
};

export function GenerateForm() {
  const router = useRouter();
  const [payload, setPayload] = useState<GenerateLessonPayload>(initialPayload);
  const [result, setResult] = useState<GenerateLessonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateField<Key extends keyof GenerateLessonPayload>(
    key: Key,
    value: GenerateLessonPayload[Key],
  ) {
    setPayload((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        const response = await generateLesson(payload);
        setResult(response);
        router.push(`/lessons/${response.lesson_id}?job=${response.job_id}`);
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Unable to generate the lesson.",
        );
      }
    });
  }

  return (
    <div className="generate-grid">
      <Panel eyebrow="Prompt to Lesson" title="Generate a Tutor Lesson">
        <form className="generate-form" onSubmit={onSubmit}>
          <label className="field">
            <span>Teaching request</span>
            <textarea
              rows={8}
              placeholder="Teach fractions to a beginner using real-life examples and end with a short quiz."
              value={payload.requirement}
              onChange={(event) => updateField("requirement", event.target.value)}
            />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Language</span>
              <select
                value={payload.language}
                onChange={(event) =>
                  updateField("language", event.target.value as GenerateLessonPayload["language"])
                }
              >
                <option value="en-US">English</option>
                <option value="zh-CN">Chinese</option>
              </select>
            </label>

            <label className="field">
              <span>Agent mode</span>
              <select
                value={payload.agent_mode}
                onChange={(event) =>
                  updateField(
                    "agent_mode",
                    event.target.value as GenerateLessonPayload["agent_mode"],
                  )
                }
              >
                <option value="default">Default</option>
                <option value="generate">Generate custom agents</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>Optional notes</span>
            <textarea
              rows={5}
              placeholder="Paste study notes or lesson context here."
              value={payload.pdf_text ?? ""}
              onChange={(event) => updateField("pdf_text", event.target.value)}
            />
          </label>

          <div className="toggle-grid">
            <label className="toggle">
              <input
                type="checkbox"
                checked={payload.enable_web_search ?? false}
                onChange={(event) =>
                  updateField("enable_web_search", event.target.checked)
                }
              />
              <span>Web search</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={payload.enable_image_generation ?? false}
                onChange={(event) =>
                  updateField("enable_image_generation", event.target.checked)
                }
              />
              <span>Image generation</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={payload.enable_video_generation ?? false}
                onChange={(event) =>
                  updateField("enable_video_generation", event.target.checked)
                }
              />
              <span>Video generation</span>
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={payload.enable_tts ?? false}
                onChange={(event) => updateField("enable_tts", event.target.checked)}
              />
              <span>Teacher audio</span>
            </label>
          </div>

          <div className="actions">
            <Button disabled={isPending || !payload.requirement.trim()} type="submit">
              {isPending ? "Generating..." : "Generate lesson"}
            </Button>
            {error ? <p className="error-text">{error}</p> : null}
          </div>
        </form>
      </Panel>

      <Panel eyebrow="Current backend reality" title="What this flow does today">
        <ul className="plain-list">
          <li>Calls the Rust backend at <code>/api/lessons/generate</code>.</li>
          <li>Waits for the lesson to be generated, then redirects to the lesson page.</li>
          <li>Uses persisted lesson and job data from the backend.</li>
          <li>Does not yet stream generation progress or live tutor events.</li>
        </ul>

        {result ? (
          <div className="result-card">
            <Pill tone="success">Latest result</Pill>
            <p>Lesson ID: {result.lesson_id}</p>
            <p>Job ID: {result.job_id}</p>
            <p>Scenes: {result.scenes_count}</p>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
