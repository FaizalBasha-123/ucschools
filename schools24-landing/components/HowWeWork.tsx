
import React from 'react';
import { useInView } from '../hooks/useInView';

const STEPS = [
    {
        title: "Discovery",
        description: "We analyze your institution's specific needs, challenges, and goals through in-depth consultation.",
        icon: (
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        )
    },
    {
        title: "Strategy",
        description: "Our team designs a tailored technology roadmap and solution architecture unique to your school.",
        icon: (
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 7m0 13V7m0 0L9 4" /></svg>
        )
    },
    {
        title: "Implementation",
        description: "Seamless deployment of software and hardware with comprehensive training for your staff.",
        icon: (
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
        )
    },
    {
        title: "Growth",
        description: "Continuous support, updates, and analytics to ensure sustained success and improvement.",
        icon: (
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
        )
    }
];

const HowWeWork: React.FC = () => {
    const [ref, isInView] = useInView(0.1);

    return (
        <section
            ref={ref as React.RefObject<HTMLElement>}
            className={`snap-section relative bg-black text-white py-24 overflow-hidden snap-active`}
        >
            <div className="max-w-7xl mx-auto px-6 relative z-10">
                <div className="mb-20 text-center">
                    <span className="text-[#f59e0b] font-bold tracking-widest uppercase text-xs mb-4 block animate-on-scroll animate-fade-up">Process</span>
                    <h2 className="text-5xl md:text-7xl font-black tracking-tighter mb-6 animate-on-scroll animate-fade-up delay-100">
                        How We <span className="text-[#f59e0b]">Work</span>
                    </h2>
                    <p className="text-xl text-slate-400 max-w-2xl mx-auto animate-on-scroll animate-fade-up delay-200">
                        A proven methodology ensuring seamless digital transformation for your institution.
                    </p>
                </div>

                <div className="grid md:grid-cols-4 gap-8 relative">
                    {/* Connecting Line (Desktop) */}
                    <div className="hidden md:block absolute top-[60px] left-0 w-full h-1 bg-white/10">
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#f59e0b] to-transparent w-1/2 animate-[shimmer_3s_infinite]" />
                    </div>

                    {STEPS.map((step, index) => (
                        <div key={index} className="relative group animate-on-scroll animate-fade-up" style={{ animationDelay: `${300 + index * 100}ms` }}>
                            {/* Step Number Badge */}
                            <div className="w-32 h-32 mx-auto bg-[#111] border border-white/10 rounded-full flex items-center justify-center relative z-10 group-hover:border-[#f59e0b] group-hover:scale-110 transition-all duration-500 shadow-2xl">
                                <div className="text-[#f59e0b] opacity-20 absolute font-black text-8xl -top-4 -right-2 select-none pointer-events-none transition-opacity group-hover:opacity-40">
                                    {index + 1}
                                </div>
                                <div className="text-white group-hover:text-[#f59e0b] transition-colors duration-300">
                                    {step.icon}
                                </div>
                            </div>

                            <div className="text-center mt-10">
                                <h3 className="text-2xl font-bold mb-4 group-hover:text-[#f59e0b] transition-colors duration-300">{step.title}</h3>
                                <p className="text-slate-400 leading-relaxed text-sm">{step.description}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default HowWeWork;
