import type { PropsWithChildren, ReactNode } from "react";

export function Shell({ children }: PropsWithChildren) {
  return <div className="ai-shell">{children}</div>;
}

export function Panel({
  title,
  eyebrow,
  children,
}: PropsWithChildren<{ title?: string; eyebrow?: string }>) {
  return (
    <section className="ai-panel">
      {eyebrow ? <p className="ai-eyebrow">{eyebrow}</p> : null}
      {title ? <h2 className="ai-panel-title">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="ai-stat">
      <span className="ai-stat-label">{label}</span>
      <strong className="ai-stat-value">{value}</strong>
    </div>
  );
}

export function Pill({
  tone = "neutral",
  children,
}: PropsWithChildren<{ tone?: "neutral" | "success" | "warning" }>) {
  return <span className={`ai-pill ai-pill-${tone}`}>{children}</span>;
}

export function Button({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="ai-button" {...props}>
      {children}
    </button>
  );
}
