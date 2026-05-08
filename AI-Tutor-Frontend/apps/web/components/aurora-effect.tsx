'use client';

import { cn } from '@/lib/utils';

interface AuroraEffectProps {
  className?: string;
  primaryColor?: string;
  secondaryColor?: string;
  intensity?: number;
}

/**
 * Top-edge aurora effect using pure CSS animations.
 *
 * We deliberately avoid animating the SVG <path d> attribute with framer-motion
 * because during SSR + hydration the motion engine temporarily sets `d` to
 * `undefined`, producing a browser console error:
 *   "Error: <path> attribute d: Expected moveto path command ('M' or 'm'), undefined"
 *
 * Instead we use static SVG paths and animate only opacity/transform via CSS
 * keyframes — no JS animation library needed, zero hydration risk, same visual effect.
 */
export function AuroraEffect({
  className,
  primaryColor = 'rgba(16, 185, 129, 0.55)',
  secondaryColor = 'rgba(52, 211, 153, 0.4)',
  intensity = 1,
}: AuroraEffectProps) {
  return (
    <>
      {/* Inject CSS keyframes once */}
      <style>{`
        @keyframes aurora-wave-1 {
          0%, 100% { opacity: 0.55; transform: scaleY(1) translateY(0px); }
          50%       { opacity: 0.75; transform: scaleY(1.08) translateY(-6px); }
        }
        @keyframes aurora-wave-2 {
          0%, 100% { opacity: 0.40; transform: scaleY(1) translateY(0px); }
          50%       { opacity: 0.60; transform: scaleY(1.06) translateY(-8px); }
        }
        @keyframes aurora-wave-3 {
          0%, 100% { opacity: 0.30; transform: scaleY(1) translateY(0px); }
          50%       { opacity: 0.50; transform: scaleY(1.04) translateY(-5px); }
        }
      `}</style>

      <div className={cn('absolute inset-0 overflow-hidden pointer-events-none z-0', className)}>
        {/* Radial glow blobs — no JS animation, pure CSS */}
        <div
          className="absolute top-0 left-0 w-full"
          style={{
            height: '320px',
            background: `radial-gradient(ellipse 80% 100% at 50% 0%, ${primaryColor} 0%, transparent 70%)`,
            transform: `scale(${intensity})`,
            animation: 'aurora-wave-1 12s ease-in-out infinite',
          }}
        />
        <div
          className="absolute top-0 left-0 w-full"
          style={{
            height: '280px',
            background: `radial-gradient(ellipse 60% 80% at 20% 0%, ${secondaryColor} 0%, transparent 60%)`,
            transform: `scale(${intensity * 0.85})`,
            animation: 'aurora-wave-2 15s ease-in-out infinite',
          }}
        />
        <div
          className="absolute top-0 right-0 w-full"
          style={{
            height: '260px',
            background: `radial-gradient(ellipse 60% 80% at 80% 0%, rgba(52, 211, 153, 0.35) 0%, transparent 60%)`,
            transform: `scale(${intensity * 0.8})`,
            animation: 'aurora-wave-3 18s ease-in-out infinite',
          }}
        />

        {/* Static SVG wave shapes — fixed paths, no d animation */}
        <svg
          className="absolute top-0 left-0 w-full"
          style={{ height: '260px', opacity: 0.45 }}
          viewBox="0 0 1440 256"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="ag1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor={primaryColor}  stopOpacity="0.9" />
              <stop offset="40%"  stopColor={secondaryColor} stopOpacity="0.7" />
              <stop offset="100%" stopColor={primaryColor}  stopOpacity="0.8" />
            </linearGradient>
            <linearGradient id="ag2" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="rgba(52,211,153,0.5)"  stopOpacity="0.7" />
              <stop offset="50%"  stopColor={secondaryColor}         stopOpacity="0.8" />
              <stop offset="100%" stopColor="rgba(16,185,129,0.55)"  stopOpacity="0.6" />
            </linearGradient>
            <linearGradient id="ag3" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="rgba(16,185,129,0.4)"  stopOpacity="0.6" />
              <stop offset="50%"  stopColor={primaryColor}           stopOpacity="0.7" />
              <stop offset="100%" stopColor="rgba(52,211,153,0.55)" stopOpacity="0.5" />
            </linearGradient>
          </defs>

          {/* Layer 1 — prominent upper wave */}
          <path
            d="M0,100 Q180,32 360,70 T720,40 T1080,80 T1440,55 L1440,0 L0,0 Z"
            fill="url(#ag1)"
            style={{ animation: 'aurora-wave-1 12s ease-in-out infinite', transformOrigin: 'center top' }}
          />
          {/* Layer 2 — mid wave */}
          <path
            d="M0,140 Q240,88 480,118 T960,72 T1440,110 L1440,0 L0,0 Z"
            fill="url(#ag2)"
            style={{ animation: 'aurora-wave-2 15s ease-in-out infinite', transformOrigin: 'center top' }}
          />
          {/* Layer 3 — deep base */}
          <path
            d="M0,180 Q360,120 720,150 T1440,122 L1440,0 L0,0 Z"
            fill="url(#ag3)"
            style={{ animation: 'aurora-wave-3 18s ease-in-out infinite', transformOrigin: 'center top' }}
          />
        </svg>

        {/* Soft bottom fade so the aurora doesn't bleed into content */}
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-transparent via-transparent to-background/60" />
      </div>
    </>
  );
}