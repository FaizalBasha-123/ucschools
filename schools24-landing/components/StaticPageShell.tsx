import React from 'react';
import Footer from './Footer';

type StaticPageShellProps = {
  eyebrow: string;
  title: React.ReactNode;
  description: string;
  children?: React.ReactNode;
};

const StaticPageShell: React.FC<StaticPageShellProps> = ({ eyebrow, title, description, children }) => {
  return (
    <div className="bg-white min-h-screen w-full selection:bg-blue-600 selection:text-white">
      <section className="pt-36 pb-20 px-6 max-w-7xl mx-auto">
        <div className="max-w-4xl">
          <span className="text-blue-600 font-bold tracking-widest uppercase text-xs mb-4 block">{eyebrow}</span>
          <h1 className="text-5xl md:text-7xl font-black text-slate-900 tracking-tighter mb-6 leading-[0.95]">
            {title}
          </h1>
          <p className="text-lg md:text-xl text-slate-500 font-medium max-w-3xl">
            {description}
          </p>
        </div>

        {children && (
          <div className="mt-14 grid gap-8 md:grid-cols-2">
            {children}
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
};

export default StaticPageShell;
