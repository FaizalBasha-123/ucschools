'use client';

import { useRef, useState } from 'react';
import { motion, useInView } from 'motion/react';

const concepts = [
  {
    number: '01',
    title: 'Perception',
    tagline: 'It reads between the lines.',
    body: 'Every question you type carries hidden signals — your frustration level, your learning velocity, your analogical style. The engine processes these signals not as data but as a student profile, building a mental model of how you think.',
    accent: '#10B981',
    glowColor: 'rgba(16,185,129,0.12)',
  },
  {
    number: '02',
    title: 'Generation',
    tagline: 'From a single thought to a full classroom.',
    body: 'In under a minute, a bare topic becomes a multi-slide, richly visual, voice-interactive lesson environment. Not a template filled with placeholders — a bespoke pedagogical construct, built fresh for you.',
    accent: '#6366F1',
    glowColor: 'rgba(99,102,241,0.12)',
  },
  {
    number: '03',
    title: 'Mastery',
    tagline: 'It doesn\'t stop until the concept clicks.',
    body: 'Traditional tools deliver information. AI-Tutor delivers understanding. The system loops — restructuring, reframing, presenting new angles — with infinite patience, until you genuinely own the idea.',
    accent: '#F59E0B',
    glowColor: 'rgba(245,158,11,0.12)',
  },
];

function ConceptCard({ concept, index }: { concept: typeof concepts[0]; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: index % 2 === 0 ? -40 : 40 }}
      animate={inView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.9, delay: index * 0.12, ease: [0.22, 1, 0.36, 1] }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative group"
      style={{ perspective: 1000 }}
    >
      {/* Card */}
      <motion.div
        animate={hovered ? { rotateY: -3, rotateX: 2, scale: 1.01 } : { rotateY: 0, rotateX: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative rounded-[2rem] border overflow-hidden"
        style={{
          background: `linear-gradient(145deg, #0a1628 0%, #061020 100%)`,
          borderColor: hovered ? concept.accent + '44' : '#ffffff0d',
          boxShadow: hovered
            ? `0 0 60px ${concept.glowColor}, inset 0 1px 0 rgba(255,255,255,0.06)`
            : `0 0 0px transparent, inset 0 1px 0 rgba(255,255,255,0.03)`,
          transition: 'box-shadow 0.4s ease, border-color 0.4s ease',
        }}
      >
        {/* Glow orb */}
        <motion.div
          animate={{ opacity: hovered ? 1 : 0 }}
          transition={{ duration: 0.4 }}
          className="absolute -top-20 -right-20 w-60 h-60 rounded-full blur-[80px] pointer-events-none"
          style={{ background: concept.glowColor }}
        />

        {/* Scan line on hover */}
        <motion.div
          animate={{ y: hovered ? ['0%', '100%'] : '0%', opacity: hovered ? [0, 0.3, 0] : 0 }}
          transition={{ duration: 1.5, ease: 'linear', repeat: hovered ? Infinity : 0 }}
          className="absolute left-0 right-0 h-[1px] pointer-events-none"
          style={{ background: `linear-gradient(90deg, transparent, ${concept.accent}60, transparent)` }}
        />

        <div className="p-8 md:p-10 relative z-10">
          {/* Number + accent line */}
          <div className="flex items-center gap-4 mb-8">
            <span
              className="text-sm font-mono font-bold tracking-widest"
              style={{ color: concept.accent + 'aa' }}
            >
              {concept.number}
            </span>
            <div
              className="flex-1 h-px max-w-16"
              style={{ background: `linear-gradient(90deg, ${concept.accent}60, transparent)` }}
            />
          </div>

          {/* Title */}
          <h3 className="text-4xl md:text-5xl font-black text-white mb-3 tracking-tight">
            {concept.title}
          </h3>

          {/* Tagline */}
          <p
            className="text-base font-semibold mb-6"
            style={{ color: concept.accent }}
          >
            {concept.tagline}
          </p>

          {/* Body */}
          <p className="text-neutral-400 leading-relaxed text-[15px]">{concept.body}</p>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function UseCasesSection() {
  const headerRef = useRef<HTMLDivElement>(null);
  const headerInView = useInView(headerRef, { once: true, margin: '-60px' });

  return (
    <section className="relative w-full overflow-hidden py-32 md:py-44 px-4">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#050d18] to-[#030b14]" />

      {/* Grid texture */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)
          `,
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative z-10 max-w-6xl mx-auto">
        {/* Header */}
        <div ref={headerRef} className="mb-20 md:mb-28">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={headerInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.6 }}
            className="flex items-center gap-3 mb-8"
          >
            <div className="h-px w-12 bg-gradient-to-r from-transparent to-neutral-700" />
            <span className="text-neutral-500 text-xs font-mono tracking-[0.3em] uppercase">
              How It Works
            </span>
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 30 }}
            animate={headerInView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="text-5xl md:text-7xl font-black text-white leading-[0.9] tracking-tight"
          >
            Three acts.
            <br />
            <span className="text-neutral-600">One transformation.</span>
          </motion.h2>
        </div>

        {/* Concept cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {concepts.map((concept, i) => (
            <ConceptCard key={concept.number} concept={concept} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
