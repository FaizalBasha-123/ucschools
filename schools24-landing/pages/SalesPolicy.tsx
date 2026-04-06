import React from 'react';
import SEOMeta from '../components/SEOMeta';
import StaticPageShell from '../components/StaticPageShell';

const SalesPolicy: React.FC = () => {
  return (
    <>
      <SEOMeta
        title="Sales Policy – MySchools"
        description="Understand how MySchools handles demos, commercial conversations, onboarding commitments, pricing, and deployment expectations with institutions."
        path="/sales-policy"
      />
      <StaticPageShell
      eyebrow="Legal"
      title={<>Sales <span className="text-blue-600">Policy</span></>}
      description="This page outlines how MySchools handles demos, commercial conversations, onboarding commitments, and deployment expectations with institutions."
    >
      <div className="rounded-[2rem] border border-slate-200 bg-slate-50 p-8 md:col-span-2">
        <p className="text-slate-600 leading-8 font-medium">
          Commercial engagements are handled directly with schools or their authorized representatives. Final scope, pricing, migration support, rollout timelines, and service commitments are agreed during the institutional onboarding and contracting process.
        </p>
      </div>
    </StaticPageShell>
    </>
  );
};

export default SalesPolicy;
