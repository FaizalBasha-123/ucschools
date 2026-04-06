import React from 'react';
import SEOMeta from '../components/SEOMeta';
import LegalPageShell from '../components/LegalPageShell';

const Disclaimer: React.FC = () => {
  return (
    <>
      <SEOMeta
        title="Disclaimer – MySchools"
        description="Read the general disclaimer for MySchools website content, informational materials, and institution-managed platform usage."
        path="/disclaimer"
      />
      <LegalPageShell
        eyebrow="Legal"
        title="Disclaimer"
        description="This disclaimer clarifies the scope of MySchools platform services and the responsibilities retained by each institution using the platform."
        sections={[
          {
            heading: 'Platform Scope',
            body: (
              <>
                <p>
                  MySchools provides software platform services, workflow tooling, public-facing forms, communication interfaces, and operational management features intended to support institutional processes. Public website material is provided for general informational and commercial reference purposes.
                </p>
              </>
            ),
          },
          {
            heading: 'School Responsibility',
            body: (
              <>
                <p>
                  Each school remains responsible for the accuracy, completeness, legality, and timeliness of its own academic records, attendance records, fee records, examination schedules, communications, and policy decisions. Platform availability does not transfer educational, administrative, or statutory accountability away from the institution.
                </p>
              </>
            ),
          },
        ]}
      />
    </>
  );
};

export default Disclaimer;
