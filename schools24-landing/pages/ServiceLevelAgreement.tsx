import React from 'react';
import SEOMeta from '../components/SEOMeta';
import LegalPageShell from '../components/LegalPageShell';

const ServiceLevelAgreement: React.FC = () => {
  return (
    <>
      <SEOMeta
        title="Service Level Agreement – MySchools"
        description="Review how MySchools approaches platform availability, support response expectations, and service continuity for schools."
        path="/service-level-agreement"
      />
      <LegalPageShell
        eyebrow="Operations"
        title="Service Level Agreement (SLA)"
        description="This page outlines the general service posture MySchools applies to uptime expectations, issue handling, and continuity support for institutions."
        sections={[
          {
            heading: 'Availability Commitment',
            body: (
              <>
                <p>
                  MySchools aims to provide stable and commercially reasonable platform availability for institutional users, subject to scheduled maintenance, upstream provider conditions, security interventions, and events outside reasonable operational control.
                </p>
              </>
            ),
          },
          {
            heading: 'Support and Incident Handling',
            body: (
              <>
                <p>
                  Service-impacting incidents are prioritized according to operational severity. Response windows, restoration expectations, and escalation handling may be defined further in a school-specific commercial or onboarding agreement where applicable.
                </p>
              </>
            ),
          },
        ]}
      />
    </>
  );
};

export default ServiceLevelAgreement;
