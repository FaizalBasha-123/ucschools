
import React from 'react';

const SERVICES = [
  "School Management Software (MySchools App)",
  "Smart Classroom Solutions (Smart Boards & Smart TVs)",
  "Student Tablet Solutions (Managed Devices)",
  "Campus Wi-Fi & Networking Solutions",
  "Computer Lab Solutions",
  "Science & Mathematics Lab Solutions",
  "Teacher & Admin Laptop Solutions",
  "School Website Design & Management",
  "Student Email & Digital Identity Solutions",
  "AI & Productivity Tool Enablement",
  "JEE & NEET Foundation & Preparation Books",
  "School Branding & Marketing Solutions",
  "End-to-End School Technology & Infrastructure Solutions"
];

const Services: React.FC = () => {
  const [showAll, setShowAll] = React.useState(false);

  // Show only first 6 if not expanded
  const displayedServices = showAll ? SERVICES : SERVICES.slice(0, 6);

  return (
    <section id="services" className="snap-section bg-black min-h-screen flex flex-col justify-center pt-20 pb-20">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-20 text-center md:text-left">
          <h2 className="text-5xl md:text-8xl font-[900] tracking-tighter leading-[0.8] text-white mb-8">
            Everything <br /> <span className="text-neutral-500">You Need.</span>
          </h2>
          <p className="text-xl text-slate-500 font-medium max-w-2xl">
            From digital infrastructure to academic excellence, we provide end-to-end solutions for modern educational institutions.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {displayedServices.map((service, i) => (
            <div key={i} className="group relative p-8 h-full min-h-[220px] rounded-[2rem] bg-[#0f0f0f] border border-white/5 overflow-hidden hover:shadow-2xl hover:shadow-black/20 transition-all duration-500 hover:-translate-y-2 cursor-default">
              {/* Gradient Blob on Hover */}
              <div className="absolute -top-20 -right-20 w-40 h-40 bg-purple-600/30 rounded-full blur-[50px] group-hover:bg-[#f59e0b]/40 transition-colors duration-500" />

              {/* Large Background Number */}
              <div className="absolute -bottom-6 -right-4 text-[120px] font-black text-white/5 leading-none select-none tracking-tighter group-hover:text-white/10 transition-colors duration-500">
                {(i + 1).toString()}
              </div>

              <div className="relative z-10 flex flex-col justify-between h-full">
                <div className="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center mb-6 group-hover:border-[#f59e0b]/50 group-hover:bg-[#f59e0b]/10 transition-colors duration-300">
                  <span className="text-white/40 font-mono text-xs group-hover:text-[#f59e0b] transition-colors">{(i + 1).toString().padStart(2, '0')}</span>
                </div>

                <h3 className="text-2xl font-bold leading-tight text-white/90 group-hover:text-white transition-colors duration-300 max-w-[85%]">
                  {service}
                </h3>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-center">
          <button
            onClick={() => setShowAll(!showAll)}
            className="px-10 py-4 rounded-full bg-white text-black font-bold tracking-wide hover:bg-[#f59e0b] hover:text-white transition-all duration-300 hover:scale-105 active:scale-95"
          >
            {showAll ? 'Show Less' : 'View All Solutions'}
          </button>
        </div>
      </div>
    </section>
  );
};

export default Services;
