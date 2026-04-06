import React from 'react';
import SEOMeta from '../components/SEOMeta';
import LegalPageShell from '../components/LegalPageShell';

const Security: React.FC = () => {
  return (
    <>
      <SEOMeta
        title="Security – MySchools"
        description="See how MySchools approaches secure platform operation, school isolation, and controlled access to institutional data."
        path="/security"
      />
      <LegalPageShell
        eyebrow="Security"
        title="Security"
        description="MySchools applies layered controls across authentication, tenant boundaries, validated workflows, and operational protections intended to support secure school operations."
        sections={[
          {
            heading: 'Access Control and Tenant Boundaries',
            body: (
              <>
                <p>
                  Access is governed by backend authorization, school-scoped tenant separation, session controls, and validation of protected actions. Data is not treated as trusted solely because it originates from a browser or client application.
                </p>
              </>
            ),
          },
          {
            heading: 'Public Workflow Protection',
            body: (
              <>
                <p>
                  Public-facing interactions such as support submissions, admissions, and appointment workflows are handled with stricter validation, controlled integration paths, and operational safeguards intended to reduce abuse while preserving usability for genuine visitors.
                </p>
              </>
            ),
          },
        ]}
      />
    </>
  );
};

export default Security;
