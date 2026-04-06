
import React from 'react';

const ValueStatement: React.FC = () => {
    return (
        <section className="py-24 bg-black text-white relative overflow-hidden border-t border-white/10 snap-active">
            <div className="max-w-7xl mx-auto px-6 relative z-10">
                <div className="grid md:grid-cols-2 gap-16 items-center">
                    <div>
                        <div className="flex items-center gap-3 mb-6">
                            <span className="text-[#f59e0b] font-black tracking-widest text-sm uppercase animate-on-scroll animate-fade-up">Our Promise</span>
                            <div className="px-3 py-1 rounded-full bg-[#f59e0b]/10 border border-[#f59e0b]/20 text-[#f59e0b] text-xs font-bold animate-on-scroll animate-fade-up delay-100">
                                India's #1 Education Operating System
                            </div>
                        </div>

                        <h2 className="text-5xl md:text-7xl font-black tracking-tighter leading-tight mb-8 animate-on-scroll animate-fade-up delay-100">
                            Premium Tech.<br />
                            <span className="text-slate-500">Fair Price.</span>
                        </h2>
                        <p className="text-xl text-slate-400 font-medium leading-relaxed max-w-lg mb-10 animate-on-scroll animate-fade-up delay-200">
                            We don't believe in overcharging education. Get the absolute best technology market-wide, at a price that fits your annual budget comfortably.
                        </p>

                        <div className="flex flex-col gap-6 animate-on-scroll animate-fade-up delay-300">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center text-green-500 border border-green-500/20">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                </div>
                                <div>
                                    <h4 className="font-bold text-lg text-white">Unbeatable Pricing</h4>
                                    <p className="text-sm text-slate-500">More features than competitors, for less cost.</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                </div>
                                <div>
                                    <h4 className="font-bold text-lg text-white">#1 Rated Performance</h4>
                                    <p className="text-sm text-slate-500">Voted best-in-class for speed and reliability.</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="relative animate-on-scroll animate-scale-in delay-200">
                        <div className="aspect-square rounded-[3rem] bg-[#0f0f0f] border border-white/5 p-12 flex flex-col justify-center items-center relative overflow-hidden group">
                            {/* Abstract Visualization of Value */}
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-blue-900/40 via-transparent to-transparent" />

                            <div className="text-center relative z-10 transform group-hover:scale-105 transition-transform duration-500">
                                <div className="text-2xl font-bold text-slate-400 mb-2">Cost vs Value</div>
                                <div className="text-9xl font-black text-white tracking-tighter leading-none mb-2">
                                    10<span className="text-blue-500 text-6xl">x</span>
                                </div>
                                <div className="px-4 py-2 bg-blue-600 rounded-full text-white text-sm font-bold inline-block shadow-lg shadow-blue-600/20">
                                    ROI Guaranteed
                                </div>
                            </div>

                            <div className="w-full mt-12 space-y-3">
                                <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-widest">
                                    <span>Us (MySchools)</span>
                                    <span>Others</span>
                                </div>
                                <div className="h-3 bg-slate-800 rounded-full overflow-hidden flex">
                                    <div className="h-full bg-blue-500 w-full animate-[slideInRight_1s_ease-out]" />
                                </div>
                                <div className="h-3 bg-slate-800 rounded-full overflow-hidden flex w-1/2 opacity-30">
                                    <div className="h-full bg-slate-500 w-full" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default ValueStatement;
