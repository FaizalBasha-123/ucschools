'use client';

import { useRef } from 'react';
import { motion, useInView } from 'motion/react';

export function FinalCTA() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <section className="relative w-full overflow-hidden py-40 md:py-56 px-4">
      {/* Deep background */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#030b14] via-[#061220] to-[#030b14]" />

      {/* Radial burst */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[800px] h-[400px] rounded-full bg-emerald-500/10 blur-[100px]" />
        <div className="absolute w-[400px] h-[200px] rounded-full bg-emerald-400/8 blur-[60px]" />
      </div>

      {/* Subtle concentric rings */}
      {[320, 480, 640, 800].map((size, i) => (
        <motion.div
          key={size}
          animate={{ scale: [1, 1.04, 1], opacity: [0.06, 0.12, 0.06] }}
          transition={{ duration: 4 + i, repeat: Infinity, delay: i * 0.8, ease: 'easeInOut' }}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-500/20 pointer-events-none"
          style={{ width: size, height: size }}
        />
      ))}

      <div ref={ref} className="relative z-10 max-w-3xl mx-auto text-center">
        {/* Eyebrow */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="flex items-center justify-center gap-3 mb-10"
        >
          <div className="h-px w-12 bg-gradient-to-r from-transparent to-emerald-500/30" />
          <span className="text-emerald-400/60 text-xs font-mono tracking-[0.3em] uppercase">
            Begin
          </span>
          <div className="h-px w-12 bg-gradient-to-l from-transparent to-emerald-500/30" />
        </motion.div>

        {/* Headline */}
        <motion.h2
          initial={{ opacity: 0, y: 40 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.9, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="text-5xl md:text-7xl font-black text-white tracking-tight leading-[0.9] mb-8"
        >
          The lesson
          <br />
          starts with{' '}
          <span
            className="relative inline-block"
            style={{
              background: 'linear-gradient(135deg, #10B981, #34D399)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            a single
            <br className="hidden md:block" /> question.
            {/* Underline */}
            <motion.div
              initial={{ scaleX: 0 }}
              animate={inView ? { scaleX: 1 } : {}}
              transition={{ duration: 0.8, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="absolute -bottom-2 left-0 right-0 h-[3px] rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 origin-left"
            />
          </span>
        </motion.h2>

        {/* Subtext */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.3 }}
          className="text-lg text-neutral-500 mb-14 leading-relaxed max-w-xl mx-auto"
        >
          Type anything — a concept, a subject, a problem you are stuck on. In moments, a living classroom materialises around your curiosity.
        </motion.p>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={inView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <button
            id="cta-scroll-to-top"
            onClick={scrollToTop}
            className="group relative inline-flex items-center gap-3 px-10 py-5 rounded-full font-bold text-lg text-white overflow-hidden transition-all hover:scale-105 active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #059669 0%, #10B981 50%, #34D399 100%)',
              boxShadow: '0 0 40px rgba(16,185,129,0.35), 0 2px 0 rgba(255,255,255,0.1) inset',
            }}
          >
            {/* Shimmer sweep */}
            <motion.div
              animate={{ x: ['-200%', '200%'] }}
              transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 1.5, ease: 'easeInOut' }}
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-12 pointer-events-none"
            />
            <span className="relative">Start Learning Now</span>
            <motion.svg
              animate={{ x: [0, 4, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              className="relative size-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </motion.svg>
          </button>
        </motion.div>

        {/* Trust note */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="mt-8 text-xs text-neutral-600 font-mono tracking-wide"
        >
          No setup · No credit card · First lesson free
        </motion.p>
      </div>
    </section>
  );
}
