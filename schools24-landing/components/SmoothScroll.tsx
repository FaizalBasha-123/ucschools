import React, { useEffect } from 'react';
import Lenis from 'lenis';

const SmoothScroll: React.FC = () => {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.15,
      smoothWheel: true,
      syncTouch: true,
      touchInertiaMultiplier: 1.15,
      wheelMultiplier: 0.92,
      gestureOrientation: 'vertical',
      easing: (t: number) => 1 - Math.pow(1 - t, 3),
    });

    let rafId = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = window.requestAnimationFrame(raf);
    };

    rafId = window.requestAnimationFrame(raf);
    return () => {
      window.cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  return null;
};

export default SmoothScroll;
