import React from 'react';
import Footer from './Footer';

type LegalSection = {
  heading: string;
  body: React.ReactNode;
};

type LegalPageShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  sections: LegalSection[];
};

const LegalPageShell: React.FC<LegalPageShellProps> = ({ eyebrow, title, description, sections }) => {
  return (
    <div className="min-h-screen w-full bg-white text-slate-900">
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-32 lg:px-8">
        <div className="border-b border-slate-200 pb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">{eyebrow}</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">{title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 md:text-lg">{description}</p>
        </div>

        <div className="mt-10 space-y-6">
          {sections.map((section) => (
            <section key={section.heading} className="rounded-2xl border border-slate-200 bg-white p-6 md:p-8">
              <h2 className="text-lg font-semibold text-slate-950 md:text-xl">{section.heading}</h2>
              <div className="mt-4 space-y-4 text-sm leading-7 text-slate-700 md:text-base">{section.body}</div>
            </section>
          ))}
        </div>
      </section>

      <Footer theme="light" showCta={false} />
    </div>
  );
};

export default LegalPageShell;
