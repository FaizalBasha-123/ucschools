export default function HomePage() {
  return (
    <main className="home-shell">
      <section className="hero-card">
        <p className="hero-eyebrow">AI Tutor Translation Project</p>
        <h1>Prompt-to-lesson frontend for the Rust tutor backend</h1>
        <p className="hero-copy">
          This workspace now consumes the real lesson generation and retrieval routes from
          <code> AI-Tutor-Backend</code>. The runtime player is still a shell, but the contract
          flow is real.
        </p>
        <div className="hero-actions">
          <a className="hero-link primary-link" href="/generate">
            Open generation studio
          </a>
        </div>
      </section>
    </main>
  );
}
