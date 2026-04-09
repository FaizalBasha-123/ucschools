export default function HomePage() {
  const templates = [
    "Prompt-to-Lesson Starter",
    "STEM Storyline",
    "Quiz Sprint",
    "Interactive Lab Scene",
    "Tutor Discussion Flow",
    "Whiteboard Action Deck",
    "Video-First Lesson",
    "Narration + Audio Mode",
  ];

  const apps = [
    "Physics Momentum Coach",
    "Biology Cell Explorer",
    "Algebra Step Builder",
    "Chemistry Bond Visualizer",
    "History Timeline Guide",
    "Language Practice Tutor",
    "Exam Revision Assistant",
    "PBL Project Mentor",
  ];

  return (
    <main className="translation-landing">
      <section className="translation-hero">
        <header className="translation-nav">
          <div className="translation-logo">AI Tutor</div>
          <nav>
            <a href="#features">Features</a>
            <a href="#templates">Templates</a>
            <a href="#apps">Apps</a>
            <a href="#metrics">Metrics</a>
          </nav>
          <a className="translation-nav-button" href="/generate">
            Open Studio
          </a>
        </header>

        <div className="translation-hero-content">
          <p className="translation-eyebrow">AI Tutor Translation Project</p>
          <h1>Prompt-to-lesson frontend for the Rust tutor backend</h1>
          <p className="translation-copy">
            This workspace now consumes the real lesson generation and retrieval routes from
            <code> AI-Tutor-Backend</code>. The runtime player is still a shell, but the contract
            flow is real.
          </p>
          <div className="translation-hero-actions">
            <a className="translation-primary" href="/generate">
              Generate a lesson
            </a>
            <a className="translation-secondary" href="/lessons/demo">
              Open lesson player
            </a>
          </div>
          <div className="translation-prompt">
            <span>Ask AI Tutor to build a complete lesson flow...</span>
            <a href="/generate">Go</a>
          </div>
        </div>
      </section>

      <section className="translation-strip">
        <p>Trusted architecture path inspired by OpenMAIC and productionized for Rust + Next.js.</p>
      </section>

      <section className="translation-feature" id="features">
        <h2>Meet AI Tutor Translation</h2>
        <div className="translation-feature-grid">
          <div className="translation-feature-art" />
          <div className="translation-feature-copy">
            <h3>Start with a teaching goal</h3>
            <p>Convert a plain prompt into a complete lesson request with real backend contracts.</p>
            <h3>Watch lessons come to life</h3>
            <p>Track generation and open persisted lessons with scene, timeline, and action flow.</p>
            <h3>Refine and ship quickly</h3>
            <p>Use model-aware generation defaults tuned for quality, reliability, and cost control.</p>
          </div>
        </div>
      </section>

      <section className="translation-grid-section" id="templates">
        <div className="translation-grid-head">
          <h2>Discover templates</h2>
        </div>
        <div className="translation-grid">
          {templates.map((template) => (
            <article key={template} className="translation-tile">
              <div className="translation-thumb" />
              <h3>{template}</h3>
              <p>Reusable prompt and scene structure for rapid lesson iteration.</p>
            </article>
          ))}
        </div>
      </section>

      <section className="translation-grid-section" id="apps">
        <div className="translation-grid-head">
          <h2>Discover apps</h2>
        </div>
        <div className="translation-grid">
          {apps.map((app) => (
            <article key={app} className="translation-tile">
              <div className="translation-thumb app" />
              <h3>{app}</h3>
              <p>Example tutor experiences built on the same runtime and streaming contract.</p>
            </article>
          ))}
        </div>
      </section>

      <section className="translation-metrics" id="metrics">
        <h2>AI Tutor in numbers</h2>
        <div className="translation-metric-grid">
          <article>
            <h3>3 modes</h3>
            <p>Stateless client state, managed runtime session, and async generation flow.</p>
          </article>
          <article>
            <h3>4 phases</h3>
            <p>Outlines, scene content, scene actions, and action fallback policy.</p>
          </article>
          <article>
            <h3>100%</h3>
            <p>Verified production build for the Next.js app in this workspace.</p>
          </article>
        </div>
      </section>

      <section className="translation-cta">
        <p>Ready to build lessons with AI Tutor?</p>
        <a className="translation-primary" href="/generate">
          Open generation studio
        </a>
      </section>

      <footer className="translation-footer">
        <p>AI Tutor Translation Project</p>
        <p>Rust backend orchestration + Next.js frontend runtime shell</p>
      </footer>
    </main>
  );
}
