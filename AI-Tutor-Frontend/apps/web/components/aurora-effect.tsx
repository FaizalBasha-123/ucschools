'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

interface AuroraEffectProps {
  className?: string;
  primaryColor?: string;
  secondaryColor?: string;
  intensity?: number;
}

export function AuroraEffect({
  className,
  primaryColor = 'rgba(16, 185, 129, 0.4)',
  secondaryColor = 'rgba(52, 211, 153, 0.3)',
  intensity = 1,
}: AuroraEffectProps) {
  return (
    <div className={cn('absolute inset-0 overflow-hidden pointer-events-none z-0', className)}>
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background/80" />
      <svg
        className="absolute top-0 left-0 w-full h-64 opacity-30"
        viewBox="0 0 1440 256"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="aurora-gradient-1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={primaryColor} stopOpacity="0.8" />
            <stop offset="30%" stopColor={secondaryColor} stopOpacity="0.5" />
            <stop offset="60%" stopColor="rgba(16, 185, 129, 0.3)" stopOpacity="0.4" />
            <stop offset="100%" stopColor={primaryColor} stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="aurora-gradient-2" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(52, 211, 153, 0.3)" stopOpacity="0.5" />
            <stop offset="50%" stopColor={secondaryColor} stopOpacity="0.7" />
            <stop offset="100%" stopColor="rgba(16, 185, 129, 0.4)" stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id="aurora-gradient-3" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(16, 185, 129, 0.2)" stopOpacity="0.4" />
            <stop offset="40%" stopColor={primaryColor} stopOpacity="0.5" />
            <stop offset="80%" stopColor="rgba(52, 211, 153, 0.3)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="rgba(16, 185, 129, 0.5)" stopOpacity="0.3" />
          </linearGradient>
        </defs>
        <motion.path
          d="M0,128 Q180,32 360,80 T720,48 T1080,96 T1440,64 L1440,0 L0,0 Z"
          fill="url(#aurora-gradient-1)"
          animate={{
            d: [
              'M0,128 Q180,32 360,80 T720,48 T1080,96 T1440,64 L1440,0 L0,0 Z',
              'M0,96 Q180,64 360,32 T720,80 T1080,48 T1440,96 L1440,0 L0,0 Z',
              'M0,160 Q180,80 360,128 T720,64 T1080,112 T1440,48 L1440,0 L0,0 Z',
              'M0,128 Q180,32 360,80 T720,48 T1080,96 T1440,64 L1440,0 L0,0 Z',
            ],
          }}
          transition={{
            duration: 12,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <motion.path
          d="M0,160 Q240,96 480,128 T960,80 T1440,120 L1440,0 L0,0 Z"
          fill="url(#aurora-gradient-2)"
          animate={{
            d: [
              'M0,160 Q240,96 480,128 T960,80 T1440,120 L1440,0 L0,0 Z',
              'M0,120 Q240,160 480,96 T960,128 T1440,80 L1440,0 L0,0 Z',
              'M0,180 Q240,64 480,160 T960,96 T1440,144 L1440,0 L0,0 Z',
              'M0,160 Q240,96 480,128 T960,80 T1440,120 L1440,0 L0,0 Z',
            ],
          }}
          transition={{
            duration: 15,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        <motion.path
          d="M0,192 Q360,128 720,160 T1440,128 L1440,0 L0,0 Z"
          fill="url(#aurora-gradient-3)"
          animate={{
            d: [
              'M0,192 Q360,128 720,160 T1440,128 L1440,0 L0,0 Z',
              'M0,144 Q360,192 720,128 T1440,160 L1440,0 L0,0 Z',
              'M0,224 Q360,96 720,192 T1440,144 L1440,0 L0,0 Z',
              'M0,192 Q360,128 720,160 T1440,128 L1440,0 L0,0 Z',
            ],
          }}
          transition={{
            duration: 18,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </svg>
      <div
        className="absolute top-0 left-0 w-full h-64 opacity-20"
        style={{
          background: `radial-gradient(ellipse 80% 100% at 50% 0%, ${primaryColor} 0%, transparent 70%)`,
          transform: `scale(${intensity})`,
        }}
      />
      <div
        className="absolute top-0 left-0 w-full h-64 opacity-15"
        style={{
          background: `radial-gradient(ellipse 60% 80% at 20% 0%, ${secondaryColor} 0%, transparent 60%)`,
          transform: `scale(${intensity * 0.8})`,
        }}
      />
      <div
        className="absolute top-0 right-0 w-full h-64 opacity-15"
        style={{
          background: `radial-gradient(ellipse 60% 80% at 80% 0%, rgba(52, 211, 153, 0.3) 0%, transparent 60%)`,
          transform: `scale(${intensity * 0.8})`,
        }}
      />
    </div>
  );
}