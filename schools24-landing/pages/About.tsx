import React from 'react';
import SEOMeta from '../components/SEOMeta';
import StaticPageShell from '../components/StaticPageShell';

const ABOUT_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  name: 'About MySchools',
  url: 'https://MySchools.in/about',
  description: 'MySchools builds a unified school operating system for administrators, teachers, students, and parents.',
  publisher: {
    '@type': 'Organization',
    name: 'MySchools',
    url: 'https://MySchools.in',
  },
};

const About: React.FC = () => {
  return (
    <>
      <SEOMeta
        title="About MySchools – Built for Schools, Not Generic Software"
        description="MySchools builds a unified school operating system that connects administrators, teachers, students, and parents inside one platform designed for real institutions."
        path="/about"
        structuredData={ABOUT_SCHEMA}
      />
      <StaticPageShell
      eyebrow="Company"
      title={<>Built for <span className="text-blue-600">schools</span>, not generic software.</>}
      description="MySchools is focused on admissions, operations, communication, and academic workflows that real institutions need to run every day without fragmentation."
    >
      <div className="rounded-[2rem] border border-slate-200 bg-slate-50 p-8">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">What we do</h2>
        <p className="text-slate-600 leading-8 font-medium">
          We build a unified school operating system that connects administrators, teachers, students, transport, admissions, finance, and communication inside one platform.
        </p>
      </div>
      <div className="rounded-[2rem] border border-slate-200 bg-slate-50 p-8">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">How we work</h2>
        <p className="text-slate-600 leading-8 font-medium">
          Tenant isolation, role-based workflows, mobile-first access, and operational reliability are the baseline. MySchools is designed to reduce manual work, not add another dashboard layer.
        </p>
      </div>
    </StaticPageShell>
    </>
  );
};

export default About;
