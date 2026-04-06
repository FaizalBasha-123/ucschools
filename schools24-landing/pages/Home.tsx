
import React from 'react';
import { Link } from 'react-router-dom';
import SEOMeta from '../components/SEOMeta';
import Hero from '../components/Hero';
import Partners from '../components/Partners';
import Services from '../components/Services';
import Features from '../components/Features';
import HowWeWork from '../components/HowWeWork';
import ValueStatement from '../components/ValueStatement';
import ScrollVideo from '../components/ScrollVideo';

import KnowUs from '../components/KnowUs';
import Footer from '../components/Footer';

const HOME_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'MySchools',
  url: 'https://MySchools.in',
  description: "India's #1 AI-powered school operating system connecting administrators, teachers, students, and parents.",
  potentialAction: {
    '@type': 'SearchAction',
    target: 'https://MySchools.in/?s={search_term_string}',
    'query-input': 'required name=search_term_string',
  },
};

const Home: React.FC = () => {
    return (
        <>
        <SEOMeta
          title="India's #1 AI-Powered School Operating System"
          description="MySchools connects administrators, teachers, students, and parents in one platform. Automate fees, attendance, timetables, admissions, and communications."
          path="/"
          structuredData={HOME_SCHEMA}
        />
        <div className="snap-container relative selection:bg-[#f59e0b] selection:text-white bg-black" style={{ backgroundColor: '#000000' }}>
            <main>
                {/* Phase 1: Brand Reveal */}
                <Hero />

                {/* Phase 2: Industry Presence */}
                <Partners />

                {/* Phase 3: Product Narrative */}
                <Services />

                {/* Phase 4: Capabilities Grid */}
                {/* Phase 4: Capabilities Grid */}
                <Features />

                {/* Phase 5: Process */}
                <HowWeWork />

                {/* Phase 6: Intelligent Discovery */}
                <KnowUs />

                <section className="relative border-t border-white/10 bg-[#030303]">
                  <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8">
                    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] lg:items-end">
                      <div className="max-w-3xl">
                        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-300">MySchools Insights</p>
                        <h2 className="mt-4 text-3xl font-bold tracking-tight text-white md:text-4xl">
                          Explore the operating playbooks behind modern schools.
                        </h2>
                        <p className="mt-4 max-w-2xl text-base leading-8 text-slate-300">
                          We use the blog to break down admissions workflows, school operations, governance, compliance, and product decisions that matter to institutions evaluating MySchools.
                        </p>
                      </div>
                      <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.24)] backdrop-blur-sm">
                        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Internal Discovery</p>
                        <div className="mt-5 space-y-4">
                          <Link to="/blogs" className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm font-semibold text-white transition hover:border-blue-400/50 hover:bg-white/[0.06]">
                            Browse all blog articles
                            <span className="text-blue-300">/blogs</span>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Phase 7: Value Proposition */}
                <ValueStatement />

                {/* Global Impact Section - Video Scroll */}
                <ScrollVideo />
            </main>

            <Footer theme="dark" />
        </div>
        </>
    );
};

export default Home;
