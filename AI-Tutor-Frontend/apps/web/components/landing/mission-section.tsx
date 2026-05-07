'use client';

import { useRef, useEffect, useState } from 'react';
import { motion, useInView, useScroll, useTransform } from 'motion/react';

const WORDS = ['Understands', 'Adapts', 'Teaches', 'Evolves', 'Remembers'];

function RotatingWord() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % WORDS.length);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="inline-block relative overflow-hidden h-[1.2em] align-middle">
      <motion.span
        key={index}
        initial={{ y: '110%', opacity: 0 }}
        animate={{ y: '0%', opacity: 1 }}
        exit={{ y: '-110%', opacity: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="absolute inset-0 flex items-center justify-start"
        style={{ color: 'transparent', WebkitTextStroke: '1.5px #10B981' }}
      >
        {WORDS[index]}
      </motion.span>
      <span className="opacity-0 pointer-events-none">{WORDS[index]}</span>
    </span>
  );
}

const NODE_COUNT = 14;

function NeuralCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    type Node = { x: number; y: number; vx: number; vy: number; r: number };
    const nodes: Node[] = Array.from({ length: NODE_COUNT }, () => ({
      x: Math.random() * canvas.offsetWidth,
      y: Math.random() * canvas.offsetHeight,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: 2 + Math.random() * 2,
    }));

    const draw = () => {
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      ctx.clearRect(0, 0, W, H);

      // Move
      nodes.forEach((n) => {
        n.x += n.vx;
        n.y += n.vy;
        if (n.x < 0 || n.x > W) n.vx *= -1;
        if (n.y < 0 || n.y > H) n.vy *= -1;
      });

      // Edges
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 140) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(16,185,129,${0.15 * (1 - dist / 140)})`;
            ctx.lineWidth = 0.7;
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // Nodes
      nodes.forEach((n) => {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(16,185,129,0.45)';
        ctx.fill();
      });

      animRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
    />
  );
}

export function MissionSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start end', 'end start'] });
  const yParallax = useTransform(scrollYProgress, [0, 1], [60, -60]);

  const inView = useInView(sectionRef, { once: true, margin: '-80px' });

  const stats = [
    { value: '1-on-1', label: 'Learning Feel' },
    { value: '∞', label: 'Patience' },
    { value: '60s', label: 'To First Lesson' },
  ];

  return (
    <section
      ref={sectionRef}
      className="relative w-full overflow-hidden py-32 md:py-44 px-4"
    >
      {/* Deep background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#050d18] via-[#061220] to-[#050d18]" />

      {/* Radial glow */}
      <motion.div
        style={{ y: yParallax }}
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <div className="w-[600px] h-[600px] rounded-full bg-emerald-500/8 blur-[120px]" />
      </motion.div>

      {/* Neural network animation */}
      <div className="absolute inset-0 opacity-60">
        <NeuralCanvas />
      </div>

      {/* Horizontal scan line */}
      <motion.div
        animate={{ y: ['0%', '100%', '0%'] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
        className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent pointer-events-none"
      />

      <div className="relative z-10 max-w-6xl mx-auto">
        {/* Label */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="flex items-center gap-3 mb-12"
        >
          <div className="h-px flex-1 max-w-[60px] bg-gradient-to-r from-transparent to-emerald-500/40" />
          <span className="text-emerald-400/70 text-xs font-mono tracking-[0.3em] uppercase">
            The Intelligence Within
          </span>
        </motion.div>

        {/* Main heading */}
        <motion.h2
          initial={{ opacity: 0, y: 30 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.1 }}
          className="text-5xl md:text-7xl font-black text-white leading-[0.95] tracking-tight mb-8"
        >
          A tutor that <br />
          <RotatingWord />{' '}
          <span className="text-white/20">you.</span>
        </motion.h2>

        {/* Body copy */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.25 }}
          className="max-w-xl"
        >
          <p className="text-lg text-neutral-400 leading-relaxed mb-4">
            The traditional classroom forces a single mind to teach thirty unique variations of learners at one speed. That model is broken by design.
          </p>
          <p className="text-neutral-500 leading-relaxed">
            AI-Tutor was built to shatter this barrier — a teaching engine that perceives your pace, your reasoning style, and your curiosity patterns, then generates a reality of learning built only for you.
          </p>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.7, delay: 0.4 }}
          className="mt-16 flex flex-wrap gap-8"
        >
          {stats.map((s, i) => (
            <div key={i} className="flex flex-col gap-1">
              <span className="text-4xl md:text-5xl font-black text-white tabular-nums">
                {s.value}
              </span>
              <span className="text-sm text-neutral-500 font-medium">{s.label}</span>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
