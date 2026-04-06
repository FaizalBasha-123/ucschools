import React from 'react';
import { useInView } from '../hooks/useInView';

const ScrollVideo: React.FC = () => {
  const [ref, isInView] = useInView(0.3);

  return (
    <section
      ref={ref as React.RefObject<HTMLElement>}
      className={`snap-section relative h-screen bg-black flex items-center justify-center overflow-hidden ${isInView ? 'snap-active' : ''}`}
    >
      <video
        src="/hallway.mp4"
        className="absolute inset-0 h-full w-full object-cover opacity-60"
        autoPlay
        loop
        muted
        playsInline
      />

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/40" />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center justify-center px-6 text-center">
        <div className="mb-20">
          <h2 className="animate-on-scroll animate-fade-up mb-4 text-5xl font-[900] tracking-tighter text-white md:text-7xl">
            Better Schools.
          </h2>
          <h2 className="animate-on-scroll animate-fade-up delay-100 text-5xl font-[900] tracking-tighter text-[#f59e0b] md:text-7xl">
            Brighter Futures.
          </h2>
        </div>
      </div>
    </section>
  );
};

export default ScrollVideo;
