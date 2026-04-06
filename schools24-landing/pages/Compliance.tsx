import React from 'react';
import SEOMeta from '../components/SEOMeta';
import LegalPageShell from '../components/LegalPageShell';

const Compliance: React.FC = () => {
  return (
    <>
      <SEOMeta
        title="Compliance – MySchools"
        description="Review the MySchools approach to compliance, responsible data handling, school safety standards, and operational controls."
        path="/compliance"
      />
      <LegalPageShell
        eyebrow="Compliance"
        title="About Compliance"
        description="This page outlines the compliance posture MySchools follows across platform operation, data handling, and institution-facing service delivery."
        sections={[
          {
            heading: 'Indian IT Act and Data Protection Approach',
            body: (
              <>
                <p>
                  MySchools is operated with attention to applicable Indian legal and operational expectations for digital services, including a structured approach to access control, traceability, operational safeguarding, and responsible handling of school-related data.
                </p>
              </>
            ),
          },
          {
            heading: 'School Safety Standards',
            body: (
              <>
                <p>
                  Platform workflows are designed to support institution-controlled usage, role separation, and reduced exposure of sensitive school records. Safety-sensitive functions remain subject to school authorization, review, and operational oversight.
                </p>
              </>
            ),
          },
        ]}
      />
    </>
  );
};

export default Compliance;
