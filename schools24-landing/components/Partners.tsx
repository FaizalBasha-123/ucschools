
import React from 'react';
import { useInView } from '../hooks/useInView';

const PARTNERS = [
  { name: 'Partner 1', image: '/partners/1.png', width: 'w-[120%]', href: 'https://www.lettuce.build/' },
  { name: 'Partner 2', image: '/partners/2.png', width: 'w-[120%]', href: 'https://www.ecoblox.build/' },
  { name: 'Partner 3', image: '/partners/3.png', width: 'w-[85%]', href: 'https://www.upcraft.in/' }
];

const Partners: React.FC = () => {
  const [ref, isInView] = useInView(0.3);

  return (
    <section
      id="partners"
      ref={ref as React.RefObject<HTMLElement>}
      className={`snap-section relative min-h-screen bg-black py-40 flex flex-col items-center justify-center overflow-hidden ${isInView ? 'snap-active' : ''}`}
    >
      <div className="max-w-6xl mx-auto px-6 text-center relative z-10">
        <span className="text-[#f59e0b] font-black uppercase tracking-[0.3em] text-[10px] block mb-12 animate-on-scroll animate-fade-up">Building the Ecosystem</span>
        <h2 className="text-5xl md:text-7xl font-[900] text-white tracking-tighter mb-24 leading-[0.9] animate-on-scroll animate-fade-up delay-200">
          The Industry <br /><span className="text-slate-500">Benchmark.</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 justify-items-center max-w-7xl mx-auto">
          {PARTNERS.map((p: any, i) => (
            <a href={p.href} target="_blank" rel="noopener noreferrer" key={i} className="flex flex-col items-center justify-center group animate-on-scroll animate-fade-up w-full" style={{ animationDelay: `${300 + i * 100}ms` }}>
              <div className="bg-white rounded-2xl w-full h-40 md:h-48 flex items-center justify-center relative overflow-hidden shadow-2xl border border-white/10 group-hover:border-white/20 transition-all duration-500">
                <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <img
                  src={p.image}
                  alt={p.name}
                  className={`${p.width || 'w-auto h-[85%]'} object-contain group-hover:scale-110 transition-transform duration-500 drop-shadow-sm`}
                />
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Scrubbed Background Text - Static for now or generic animation */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03] select-none flex items-center justify-center overflow-hidden">
        <div className="text-[30vw] font-black whitespace-nowrap">PARTNERS</div>
      </div>
    </section>
  );
};

export default Partners;
