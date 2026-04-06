import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useInView } from '../hooks/useInView';

const Hero: React.FC = () => {
  const [ref, isInView] = useInView(0.1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Parallax mouse effect for floating cards
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const { clientX, clientY } = e;
      const x = (clientX / window.innerWidth - 0.5) * 40;
      const y = (clientY / window.innerHeight - 0.5) * 40;
      containerRef.current.style.setProperty('--mouse-x', `${x}px`);
      containerRef.current.style.setProperty('--mouse-y', `${y}px`);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className={`snap-section relative min-h-screen bg-black overflow-hidden flex items-center justify-center pt-20 pb-32 snap-active`}
    >
      {/* Dynamic Background Effects */}
      <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_0%,rgba(79,70,229,0.15)_0%,transparent_50%)]" />
      <div className="absolute inset-0 z-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-50" />

      {/* Ambient glowing orbs */}
      <div className="absolute top-1/4 left-1/4 w-48 h-48 md:w-96 md:h-96 bg-blue-600/30 rounded-full blur-[80px] md:blur-[128px] animate-pulse" style={{ animationDuration: '4s' }} />
      <div className="absolute bottom-1/4 right-1/4 w-48 h-48 md:w-96 md:h-96 bg-purple-600/30 rounded-full blur-[80px] md:blur-[128px] animate-pulse" style={{ animationDuration: '6s' }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 md:w-[500px] md:h-[500px] bg-indigo-500/10 rounded-full blur-[60px] md:blur-[100px] pointer-events-none" />

      {/* Interactive Container */}
      <div className="relative z-10 w-full max-w-7xl mx-auto px-6 flex flex-col items-center text-center">

        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-8 backdrop-blur-md animate-on-scroll animate-fade-up shadow-[0_0_20px_rgba(255,255,255,0.05)] cursor-default">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span className="text-white/80 text-xs font-semibold tracking-wide uppercase">Powering schools, Empowering students</span>
        </div>

        {/* Headline */}
        <h1 className="text-[2.6rem] sm:text-6xl md:text-8xl lg:text-[110px] font-black tracking-tighter leading-[0.9] text-white mb-6 md:mb-8 animate-on-scroll animate-fade-up delay-100">
          Run your school With<br />
          <span className="text-[#f59e0b] drop-shadow-sm"> MySchools.</span>
        </h1>

        {/* Subtitle */}
        <p className="max-w-2xl text-base md:text-xl text-slate-400 font-medium mb-10 md:mb-12 animate-on-scroll animate-fade-up delay-200 px-2 md:px-0">
          The all-in-one OS for modern educational institutions. Admissions, academics, finance, and communication seamlessly connected in one intelligent platform.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto animate-on-scroll animate-fade-up delay-300 relative z-20">
          <Link
            to="/register"
            className="px-8 py-4 bg-[#f59e0b] hover:bg-[#d97706] text-black rounded-full font-bold text-lg transition-all duration-300 flex items-center justify-center gap-2 group shadow-[0_0_32px_rgba(245,158,11,0.3)] hover:shadow-[0_0_48px_rgba(245,158,11,0.5)] hover:-translate-y-0.5"
          >
            Book a Demo
            </Link>
        </div>

        {/* Mobile floating cards — horizontal scroll strip */}
        <div className="lg:hidden w-full mt-10 -mx-6 px-6 overflow-x-auto flex gap-4 pb-2 animate-on-scroll animate-fade-up delay-400">
          {/* Card 1 - Attendance */}
          <div className="shrink-0 w-52 p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md shadow-xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </div>
              <div className="text-left">
                <div className="text-white text-sm font-bold">Grade 9A</div>
                <div className="text-indigo-300/80 text-[10px] uppercase tracking-wider font-bold">Attendance</div>
              </div>
            </div>
            <div className="flex gap-1.5 justify-between">
              {['M', 'T', 'W', 'T', 'F'].map((d, i) => (
                <div key={i} className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold ${i === 2 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>{d}</div>
              ))}
            </div>
          </div>
          {/* Card 2 - Payment */}
          <div className="shrink-0 w-52 p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md shadow-xl">
            <div className="flex justify-between items-center mb-3">
              <div className="text-emerald-400 text-xs font-bold flex items-center gap-1.5 uppercase tracking-wide">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Received
              </div>
              <div className="text-white/30 text-[10px] font-bold">Just now</div>
            </div>
            <div className="text-2xl font-black text-white mb-1 tracking-tight text-left">₹45,000</div>
            <div className="text-white/50 text-xs font-medium text-left">Term 2 Fee • Aryan Sharma</div>
          </div>
          {/* Card 3 - Analytics */}
          <div className="shrink-0 w-44 p-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md shadow-xl">
            <div className="text-white/90 text-sm font-bold mb-3 text-left">Avg Performance</div>
            <div className="h-14 flex items-end justify-between gap-1">
              {[40, 60, 45, 80, 65, 90].map((h, i) => (
                <div key={i} className="w-full bg-gradient-to-t from-purple-500/10 to-purple-400/80 rounded-sm" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        </div>

        {/* Desktop floating cards — absolute positioned */}
        <div
          ref={containerRef}
          className="absolute inset-0 pointer-events-none z-0 hidden lg:block will-change-transform"
          style={{ perspective: '1000px', transform: 'translate(var(--mouse-x, 0), var(--mouse-y, 0))', transition: 'transform 0.1s ease-out' }}
        >

          {/* Floating Card 1 - Attendance (Top Left) */}
          <div className="absolute top-[10%] -left-[15%] w-60 p-5 rounded-[2rem] bg-white/5 border border-white/10 backdrop-blur-md transform -rotate-12 hover:-rotate-6 transition-transform duration-500 shadow-2xl animate-[float_6s_ease-in-out_infinite]">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </div>
              <div className="text-left">
                <div className="text-white text-sm font-bold">Grade 9A</div>
                <div className="text-indigo-300/80 text-[10px] uppercase tracking-wider font-bold">Attendance Marked</div>
              </div>
            </div>
            <div className="flex gap-2 justify-between">
              {['M', 'T', 'W', 'T', 'F'].map((d, i) => (
                <div key={i} className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${i === 2 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                  {d}
                </div>
              ))}
            </div>
          </div>

          {/* Floating Card 2 - Payment (Bottom Right) */}
          <div className="absolute bottom-[20%] -right-[15%] w-64 p-5 rounded-[2rem] bg-white/5 border border-white/10 backdrop-blur-md transform rotate-12 hover:rotate-6 transition-transform duration-500 shadow-2xl animate-[float_8s_ease-in-out_infinite_1s]">
            <div className="flex justify-between items-center mb-4">
              <div className="text-emerald-400 text-xs font-bold flex items-center gap-1.5 uppercase tracking-wide">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Received
              </div>
              <div className="text-white/30 text-[10px] font-bold">Just now</div>
            </div>
            <div className="text-3xl font-black text-white mb-2 tracking-tight text-left">₹45,000</div>
            <div className="text-white/50 text-xs font-medium text-left">Term 2 Fee • Aryan Sharma</div>
          </div>

          {/* Floating Card 3 - Analytics (Top Right / Middle) */}
          <div className="absolute top-[35%] -right-[5%] w-48 p-5 rounded-[2rem] bg-white/5 border border-white/10 backdrop-blur-md transform rotate-6 hover:rotate-12 transition-transform duration-500 shadow-2xl animate-[float_7s_ease-in-out_infinite_2s]">
            <div className="text-white/90 text-sm font-bold mb-4 text-left">Avg Performance</div>
            <div className="h-20 flex items-end justify-between gap-1.5">
              {[40, 60, 45, 80, 65, 90].map((h, i) => (
                <div key={i} className="w-full bg-gradient-to-t from-purple-500/10 to-purple-400/80 rounded-sm" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>

        </div>
      </div>

    </section>
  );
};

export default Hero;
