
import React, { useState, useEffect } from 'react';
import { useInView } from '../hooks/useInView';

const Features: React.FC = () => {
  const [ref, isInView] = useInView(0.1);
  const [attendanceDay, setAttendanceDay] = useState(0);
  const [feeProgress, setFeeProgress] = useState(0);
  const [gradeVal, setGradeVal] = useState(0);

  useEffect(() => {
    if (!isInView) return;
    const t1 = setTimeout(() => {
      let d = 0;
      const i = setInterval(() => { d++; setAttendanceDay(d); if (d >= 5) clearInterval(i); }, 200);
    }, 400);
    const t2 = setTimeout(() => {
      let p = 0;
      const i = setInterval(() => { p += 2; setFeeProgress(p); if (p >= 82) clearInterval(i); }, 20);
    }, 600);
    const t3 = setTimeout(() => {
      let g = 0;
      const i = setInterval(() => { g += 2; setGradeVal(g); if (g >= 94) clearInterval(i); }, 15);
    }, 800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [isInView]);

  const attendanceDays = ['M', 'T', 'W', 'T', 'F'];
  const attendanceStatus = [true, true, false, true, true];

  return (
    <section
      id="discover"
      ref={ref as React.RefObject<HTMLElement>}
      className={`snap-section relative bg-black text-white min-h-screen flex flex-col justify-center pt-10 pb-20 overflow-hidden ${isInView ? 'snap-active' : ''}`}
    >
      <div className="max-w-7xl mx-auto px-6 h-full flex flex-col justify-center">
        <div className="grid lg:grid-cols-12 gap-12 items-end mb-16">
          <div className="lg:col-span-8">
            <h2 className="text-6xl md:text-8xl font-black tracking-tighter leading-[0.85] text-white animate-on-scroll animate-fade-up delay-100">
              Everything you need <br />
              <span className="text-neutral-500">for the perfect fit.</span>
            </h2>
          </div>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-5">

          {/* 1. School ERP — Attendance Live Tracker */}
          <div className="md:col-span-2 md:row-span-2 relative rounded-[2.5rem] overflow-hidden group animate-on-scroll animate-scale-in delay-100"
            style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)' }}>
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_top_left,_#6366f1,_transparent_60%)]" />
            <div className="relative z-10 p-10 h-full flex flex-col justify-between min-h-[420px]">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 mb-4">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                  <span className="text-indigo-300 text-xs font-bold tracking-widest uppercase">Live</span>
                </div>
                <h3 className="text-3xl font-black text-white mb-2">Attendance Tracker</h3>
                <p className="text-indigo-200/70 text-sm font-medium max-w-xs">Real-time student presence with instant parent notifications.</p>
              </div>

              {/* Attendance Widget */}
              <div className="mt-6 bg-white/5 rounded-2xl p-5 border border-white/10 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-white/60 text-xs font-bold uppercase tracking-wider">This Week — Grade 8A</span>
                  <span className="text-green-400 text-xs font-black">96.2%</span>
                </div>
                <div className="flex gap-3">
                  {attendanceDays.map((day, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-2">
                      <div className={`w-full h-14 rounded-xl flex items-center justify-center text-lg font-black transition-all duration-500
                        ${i < attendanceDay
                          ? attendanceStatus[i]
                            ? 'bg-green-500 text-white shadow-lg shadow-green-500/30'
                            : 'bg-red-500/80 text-white shadow-lg shadow-red-500/20'
                          : 'bg-white/5 text-white/20'
                        }`}>
                        {i < attendanceDay ? (attendanceStatus[i] ? '✓' : '✗') : ''}
                      </div>
                      <span className="text-white/40 text-xs font-bold">{day}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <div className="flex-1 flex items-center gap-2 bg-green-500/10 rounded-xl p-3">
                    <span className="text-green-400 text-xl font-black">38</span>
                    <span className="text-green-300/60 text-xs">Present</span>
                  </div>
                  <div className="flex-1 flex items-center gap-2 bg-red-500/10 rounded-xl p-3">
                    <span className="text-red-400 text-xl font-black">2</span>
                    <span className="text-red-300/60 text-xs">Absent</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Fee Management — Animated Progress */}
          <div className="md:col-span-2 relative rounded-[2.5rem] overflow-hidden group animate-on-scroll animate-scale-in delay-200"
            style={{ background: 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)' }}>
            <div className="absolute inset-0 opacity-30 bg-[radial-gradient(ellipse_at_bottom_right,_#10b981,_transparent_60%)]" />
            <div className="relative z-10 p-10 flex flex-col gap-5">
              <div>
                <h3 className="text-2xl font-black text-white mb-1">Fee Collection</h3>
                <p className="text-emerald-200/60 text-sm">₹24,80,000 collected this term</p>
              </div>
              <div>
                <div className="flex justify-between mb-2">
                  <span className="text-white/60 text-xs font-bold">Annual Target</span>
                  <span className="text-emerald-300 text-sm font-black">{feeProgress}%</span>
                </div>
                <div className="h-3 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-green-300 rounded-full transition-all duration-100 shadow-lg shadow-emerald-500/40"
                    style={{ width: `${feeProgress}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Paid', val: '412', color: 'text-emerald-300' },
                  { label: 'Pending', val: '86', color: 'text-yellow-300' },
                  { label: 'Overdue', val: '12', color: 'text-red-300' },
                ].map((s, i) => (
                  <div key={i} className="bg-white/5 rounded-2xl p-3 text-center border border-white/10">
                    <div className={`text-xl font-black ${s.color}`}>{s.val}</div>
                    <div className="text-white/40 text-xs mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 3. Gradebook */}
          <div className=" relative rounded-[2.5rem] overflow-hidden group animate-on-scroll animate-scale-in delay-300"
            style={{ background: 'linear-gradient(135deg, #4c1d95 0%, #5b21b6 100%)' }}>
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_top_right,_#a78bfa,_transparent_60%)]" />
            <div className="relative z-10 p-8 flex flex-col gap-4">
              <div>
                <h3 className="text-xl font-black text-white">Smart Gradebook</h3>
                <p className="text-purple-200/60 text-xs mt-1">Class average performance</p>
              </div>
              <div className="flex items-center justify-center py-3">
                <div className="relative w-24 h-24">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(167,139,250,0.15)" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="url(#gradGrad)" strokeWidth="3"
                      strokeDasharray={`${gradeVal} 100`} strokeLinecap="round" />
                    <defs>
                      <linearGradient id="gradGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#a78bfa" />
                        <stop offset="100%" stopColor="#f0abfc" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-white font-black text-xl leading-none">{gradeVal}%</span>
                    <span className="text-purple-300 text-[10px]">avg</span>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                {[['Math', 92], ['Science', 88], ['English', 96]].map(([sub, sc], i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-purple-200/70 text-xs w-14">{sub}</span>
                    <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-400 rounded-full" style={{ width: isInView ? `${sc}%` : '0%', transition: `width 1s ease ${i * 0.2 + 0.8}s` }} />
                    </div>
                    <span className="text-purple-300 text-xs font-bold w-6">{sc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 4. Timetable */}
          <div className="md:col-span-1 relative rounded-[2.5rem] overflow-hidden group animate-on-scroll animate-scale-in delay-400"
            style={{ background: 'linear-gradient(135deg, #7c2d12 0%, #c2410c 100%)' }}>
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_bottom_left,_#fb923c,_transparent_60%)]" />
            <div className="relative z-10 p-8 flex flex-col gap-4">
              <div>
                <h3 className="text-xl font-black text-white">Timetable Planner</h3>
                <p className="text-orange-200/60 text-xs mt-1">Today's schedule • Grade 9B</p>
              </div>
              <div className="space-y-2">
                {[
                  { time: '8:00', sub: 'Mathematics', color: 'bg-orange-400' },
                  { time: '9:00', sub: 'Physics', color: 'bg-amber-400' },
                  { time: '10:00', sub: 'English', color: 'bg-red-400' },
                  { time: '11:00', sub: 'Biology', color: 'bg-green-400' },
                ].map((p, i) => (
                  <div key={i} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all duration-300 group-hover:translate-x-1 border border-white/5 bg-white/5
                    ${i === 0 ? 'ring-1 ring-orange-400/50 bg-orange-500/10' : ''}`}
                    style={{ transitionDelay: `${i * 60}ms` }}>
                    <div className={`w-1.5 h-6 rounded-full ${p.color}`} />
                    <span className="text-white/40 text-[10px] font-mono w-10">{p.time}</span>
                    <span className="text-white/90 text-xs font-semibold">{p.sub}</span>
                    {i === 0 && <span className="ml-auto text-[9px] bg-orange-500/30 text-orange-300 px-2 py-0.5 rounded-full font-bold">NOW</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 5. Student Hub */}
          <div className="md:col-span-2 relative rounded-[2.5rem] overflow-hidden group animate-on-scroll animate-scale-in delay-300"
            style={{ background: 'linear-gradient(135deg, #0c4a6e 0%, #0ea5e9 100%)' }}>
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_top,_#38bdf8,_transparent_60%)]" />
            <div className="relative z-10 p-10 flex flex-col gap-5">
              <div>
                <h3 className="text-2xl font-black text-white">Student Hub</h3>
                <p className="text-sky-200/60 text-sm mt-1">Everything students need, in one place.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>, label: 'Assignments', val: '3 due', col: 'bg-zinc-800/80 border-white/5' },
                  { icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>, label: 'Results', val: 'GPA 3.8', col: 'bg-zinc-800/80 border-white/5' },
                  { icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>, label: 'Messages', val: '2 new', col: 'bg-zinc-800/80 border-white/5' },
                  { icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>, label: 'Rank', val: '#4 / 40', col: 'bg-zinc-800/80 border-white/5' },
                ].map((item, i) => (
                  <div key={i} className={`border ${item.col} rounded-2xl p-4 group-hover:scale-[1.02] transition-transform duration-300 cursor-default shadow-inner`}
                    style={{ transitionDelay: `${i * 50}ms` }}>
                    <div className="text-sky-300 mb-2">{item.icon}</div>
                    <div className="text-white/50 text-[10px] font-bold uppercase tracking-wider">{item.label}</div>
                    <div className="text-white font-black text-sm mt-0.5">{item.val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 7. AI Insights */}
          <div className="md:col-span-2 relative rounded-[2.5rem] overflow-hidden group animate-on-scroll animate-scale-in delay-400"
            style={{ background: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)' }}>
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(168,85,247,0.15),_transparent_70%)]" />
            <div className="relative z-10 p-10 flex flex-col gap-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-2xl font-black text-white">Adam AI</h3>
                  <p className="text-zinc-400 text-sm mt-1">Your personal study assistant, always ready.</p>
                </div>
                <div className="flex items-center gap-1.5 bg-purple-500/10 border border-purple-500/20 px-3 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                  <span className="text-purple-300 text-[10px] font-mono font-bold">AI</span>
                </div>
              </div>

              {/* Chat bubble demo */}
              <div className="space-y-3">
                <div className="flex gap-2 items-start">
                  <div className="w-7 h-7 rounded-full bg-purple-500/30 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
                    <svg className="w-3.5 h-3.5 text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-2xl rounded-tl-sm px-4 py-2.5 text-xs text-white/70 font-medium leading-relaxed max-w-[85%]">
                    Can you explain Newton's laws simply?
                  </div>
                </div>
                <div className="flex gap-2 items-start flex-row-reverse">
                  <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0">
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </div>
                  <div className="bg-purple-600/20 border border-purple-500/20 rounded-2xl rounded-tr-sm px-4 py-2.5 text-xs text-purple-100 font-medium leading-relaxed max-w-[85%]">
                    Sure! Newton's First Law: an object stays at rest or in motion unless a force acts on it — also called <span className="text-purple-300 font-bold">Inertia</span>.
                  </div>
                </div>
                <div className="flex gap-2 items-start">
                  <div className="w-7 h-7 rounded-full bg-white/10 border border-white/10 flex items-center justify-center flex-shrink-0">
                    <svg className="w-3.5 h-3.5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  </div>
                  <div className="bg-white/5 border border-white/10 rounded-2xl rounded-tl-sm px-4 py-2.5 text-xs text-white/40 font-medium flex items-center gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 8. Gov-Grade Security & Interop */}
          <div className="md:col-span-4 relative rounded-[2.5rem] overflow-hidden group animate-on-scroll animate-scale-in delay-400"
            style={{ background: 'linear-gradient(135deg, #022c22 0%, #064e3b 100%)' }}>
            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(ellipse_at_top_right,_#10b981,_transparent_60%)]" />
            <div className="relative z-10 p-10 flex flex-col md:flex-row gap-8 items-center justify-between">
              <div className="flex-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 mb-4">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                  <span className="text-emerald-300 text-xs font-bold tracking-widest uppercase">Government-Grade Security</span>
                </div>
                <h3 className="text-3xl md:text-4xl font-black text-white mb-3">Gov Ecosystem Interop</h3>
                <p className="text-emerald-100/70 text-sm md:text-base font-medium max-w-lg mb-6">
                  Schools24 natively syncs with India's digital education infrastructure, ensuring unbreakable compliance and seamless data transfers.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'NDEAR', desc: 'Compliant Architecture', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /> },
                    { label: 'DigiLocker', desc: 'Secure Certificate Push', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /> },
                    { label: 'DIKSHA', desc: 'Registry Synchronization', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /> },
                    { label: 'ABC / APAAR', desc: 'One Nation One Student', icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" /> },
                  ].map((feat, i) => (
                    <div key={i} className="flex gap-3 items-center group/feat">
                      <div className="w-full sm:w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover/feat:bg-emerald-500/20 group-hover/feat:border-emerald-500/30 transition-colors shrink-0">
                        <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">{feat.icon}</svg>
                      </div>
                      <div>
                        <div className="text-white font-bold text-sm tracking-wide">{feat.label}</div>
                        <div className="text-white/40 text-[10px] uppercase font-bold tracking-wider mt-0.5">{feat.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="relative w-full md:w-auto mt-8 md:mt-0 flex justify-center">
                <div className="relative w-48 h-48 sm:w-64 sm:h-64">
                   <div className="absolute inset-0 rounded-full border border-emerald-500/30 border-dashed animate-[spin_10s_linear_infinite]" />
                   <div className="absolute inset-4 rounded-full border border-emerald-400/20 animate-[spin_15s_linear_infinite_reverse]" />
                   <div className="absolute inset-8 rounded-full bg-emerald-500/10 backdrop-blur-xl border border-emerald-500/40 flex items-center justify-center">
                     <svg className="w-16 h-16 sm:w-20 sm:h-20 text-emerald-400 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                   </div>
                   {/* Orbiting nodes */}
                   <div className="absolute inset-0 animate-[spin_12s_linear_infinite]">
                     <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-8 h-8 bg-black border border-emerald-500/50 rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(16,185,129,0.3)]">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                     </div>
                   </div>
                   <div className="absolute inset-0 animate-[spin_8s_linear_infinite_reverse]">
                     <div className="absolute top-1/2 -right-2 -translate-y-1/2 w-6 h-6 bg-black border border-emerald-500/50 rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(16,185,129,0.3)]">
                       <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                     </div>
                   </div>
                </div>
              </div>
            </div>
          </div>

          {/* 9. Connectivity — Full width */}
          <div className="md:col-span-4 bg-[#0a0a0a] rounded-[3rem] p-12 animate-on-scroll animate-scale-in delay-500 overflow-hidden relative border border-white/5">
            {/* Background Effects */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-transparent to-transparent opacity-50" />

            <div className="relative z-10 text-center mb-16">
              <h3 className="text-4xl md:text-5xl font-black tracking-tight mb-4 text-white">One Platform. <span className="text-blue-500">Total Connectivity.</span></h3>
              <p className="text-xl text-slate-400 font-medium max-w-2xl mx-auto">Seamlessly connecting data, people, and decisions across your entire campus.</p>
            </div>

            <div className="flex flex-col md:flex-row justify-center items-center gap-4 md:gap-12 relative z-10 py-8">
              {/* Student Node */}
              <div className="flex flex-col items-center gap-6 group relative z-20">
                <div className="w-24 h-24 rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white group-hover:bg-blue-500/[0.15] group-hover:border-blue-500/50 group-hover:scale-110 transition-all duration-500 shadow-2xl">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 14l9-5-9-5-9 5 9 5z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4.75 5.25a3 3 0 013 3M12 14v5" /></svg>
                </div>
                <span className="font-bold text-slate-300 tracking-wide uppercase text-sm group-hover:text-blue-400 transition-colors">Student</span>
              </div>

              {/* Left Connector */}
              <div className="hidden md:flex flex-1 max-w-[150px] overflow-hidden relative h-[2px] bg-white/10 rounded-full">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-500 to-transparent w-1/2 animate-[shimmer_2s_infinite]" />
              </div>

              {/* Central Admin Hub */}
              <div className="flex flex-col items-center gap-6 group relative z-20">
                <div className="relative">
                  <div className="absolute -inset-4 bg-blue-600/30 rounded-full blur-xl animate-pulse" />
                  <div className="w-32 h-32 rounded-full bg-gradient-to-br from-blue-600 to-blue-700 shadow-[0_0_50px_rgba(37,99,235,0.3)] flex items-center justify-center text-white relative z-10 ring-4 ring-black ring-opacity-50">
                    <svg className="w-14 h-14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
                  </div>
                </div>
                <span className="font-black text-white uppercase tracking-[0.2em] text-sm">Admin Hub</span>
              </div>

              {/* Right Connector */}
              <div className="hidden md:flex flex-1 max-w-[150px] overflow-hidden relative h-[2px] bg-white/10 rounded-full">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-500 to-transparent w-1/2 animate-[shimmer_2s_infinite_1s]" />
              </div>

              {/* Teacher Node */}
              <div className="flex flex-col items-center gap-6 group relative z-20">
                <div className="w-24 h-24 rounded-3xl bg-white/5 backdrop-blur-sm border border-white/10 flex items-center justify-center text-white group-hover:bg-blue-500/[0.15] group-hover:border-blue-500/50 group-hover:scale-110 transition-all duration-500 shadow-2xl">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                </div>
                <span className="font-bold text-slate-300 tracking-wide uppercase text-sm group-hover:text-blue-400 transition-colors">Teacher</span>
              </div>
            </div>

            {/* Commented out stats for future use */}
            {/*
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mt-12 pt-12 border-t border-white/10 relative z-10">
              <div className="text-center">
                <div className="text-3xl font-black text-white mb-1">0</div>
                <div className="text-blue-400/80 text-xs tracking-wider uppercase font-bold">Schools</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-black text-white mb-1">0</div>
                <div className="text-blue-400/80 text-xs tracking-wider uppercase font-bold">Happy Students</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-black text-white mb-1">100%</div>
                <div className="text-blue-400/80 text-xs tracking-wider uppercase font-bold">Data Secured</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-black text-white mb-1">24/7</div>
                <div className="text-blue-400/80 text-xs tracking-wider uppercase font-bold">Consulting Hub</div>
              </div>
            </div>
            */}
          </div>

        </div>
      </div>
    </section>
  );
};

export default Features;
