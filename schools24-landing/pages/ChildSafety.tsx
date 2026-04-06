import React from 'react';
import SEOMeta from '../components/SEOMeta';
import LegalPageShell from '../components/LegalPageShell';

const ChildSafety: React.FC = () => {
  return (
    <>
      <SEOMeta
        title="Child Safety – MySchools"
        description="Understand how MySchools approaches child safety, moderated access, school-controlled workflows, and reporting of unsafe behavior."
        path="/child-safety"
      />
      <LegalPageShell
        eyebrow="Safety"
        title="Child Safety"
        description="This page outlines the controls and escalation posture MySchools applies to support safe school-managed usage of the platform."
        sections={[
          {
            heading: 'Institution-Controlled Access',
            body: (
              <>
                <p>
                  Student-facing access is intended to operate within a school-controlled environment. Role boundaries, class scoping, institutional administration, and backend authorization are used to reduce inappropriate access to sensitive academic, fee, attendance, and communication workflows.
                </p>
              </>
            ),
          },
          {
            heading: 'Reporting and Escalation',
            body: (
              <>
                <p>
                  Where unsafe, abusive, or inappropriate activity is identified, the matter should be escalated through the relevant school authority and through MySchools support channels so access can be reviewed, restricted, or investigated as appropriate.
                </p>
              </>
            ),
          },
        ]}
      />
    </>
  );
};

export default ChildSafety;
