import React from 'react';
import SEOMeta from '../components/SEOMeta';
import LegalPageShell from '../components/LegalPageShell';

const PrivacyPolicy: React.FC = () => {
  return (
    <>
      <SEOMeta
        title="Privacy Policy"
        description="Read how MySchools collects, uses, and protects your data across its public website, school platform, and mobile applications."
        path="/privacy-policy"
      />
      <LegalPageShell
        eyebrow="Legal"
        title="Privacy Policy"
        description="This policy explains what information MySchools collects, why that information is processed, and how institutional data is handled across the website, platform, and related services."
        sections={[
          {
            heading: 'Information We Collect',
            body: (
              <>
                <p>
                  MySchools may collect student profile data required for school operations, including identity details, class associations, attendance records, assessment records, and timetable-linked academic data. We also process teacher data required for scheduling, classroom operations, content uploads, communication workflows, and authorized school administration.
                </p>
                <p>
                  Where provided by a school or guardian, parent and emergency contact data may include names, phone numbers, email addresses, and relationship details used for admissions, communication, transport, fee coordination, and school-managed notifications.
                </p>
              </>
            ),
          },
          {
            heading: 'Cookies, Analytics, and Website Usage',
            body: (
              <>
                <p>
                  The public website uses essential browser storage for navigation, security protections, and reliable form behavior. Optional analytics storage is disabled by default and is activated only after explicit user consent.
                </p>
                <p>
                  Where analytics consent is granted, measurement data is used to improve service quality, diagnose operational issues, and understand aggregate usage trends. Visitors can decline analytics and continue using the public website. For minor users, analytics should remain disabled unless verified guardian consent has been obtained by the relevant school or guardian workflow.
                </p>
              </>
            ),
          },
          {
            heading: 'Data Storage and Protection',
            body: (
              <>
                <p>
                  MySchools stores operational data only to the extent required to deliver platform services, maintain auditability, support school workflows, and preserve system integrity. Access to school data is restricted through role-based controls, tenant boundaries, and backend validation of protected actions.
                </p>
                <p>
                  We apply administrative, technical, and operational safeguards intended to protect stored information from unauthorized access, misuse, or accidental loss. Retention periods may vary depending on contractual, operational, legal, or school-directed requirements.
                </p>
              </>
            ),
          },
        ]}
      />
    </>
  );
};

export default PrivacyPolicy;
