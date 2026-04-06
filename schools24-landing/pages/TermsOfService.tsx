import React from 'react';
import SEOMeta from '../components/SEOMeta';
import LegalPageShell from '../components/LegalPageShell';

const TermsOfService: React.FC = () => {
  return (
    <>
      <SEOMeta
        title="Terms of Service"
        description="Review the terms governing use of the MySchools platform, including access rules, institutional responsibilities, and prohibited activities."
        path="/terms-of-service"
      />
      <LegalPageShell
        eyebrow="Legal"
        title="Terms & Conditions"
        description="These terms govern the use of MySchools website properties, institutional onboarding flows, and platform services made available to authorized schools and users."
        sections={[
          {
            heading: 'Eligibility and Authorized Use',
            body: (
              <>
                <p>
                  MySchools may be used only by institutions, personnel, students, parents, guardians, and other users who are authorized by the relevant school or by MySchools for a legitimate platform purpose. Access must remain within the scope of the assigned role, school, and permitted workflow.
                </p>
              </>
            ),
          },
          {
            heading: 'Account Responsibilities',
            body: (
              <>
                <p>
                  Each institution is responsible for the accounts it authorizes, the operational roles it assigns, and the accuracy of the records it maintains through the platform. Users must keep credentials secure, avoid unauthorized sharing of access, and notify the institution or MySchools where compromise is suspected.
                </p>
              </>
            ),
          },
          {
            heading: 'Payments, Misuse Restrictions, and Suspension Rights',
            body: (
              <>
                <p>
                  Paid subscriptions, onboarding charges, or deployment-related commercial terms are governed by the applicable institutional agreement, proposal, or invoice. Use of MySchools for unauthorized scraping, reverse engineering, abusive automation, data harvesting, fraud, harassment, or disruption of service is prohibited.
                </p>
                <p>
                  MySchools reserves the right to suspend, restrict, or terminate access where there is suspected misuse, material breach of terms, operational risk, unpaid dues under an agreed commercial arrangement, or conduct that threatens platform security or school safety.
                </p>
              </>
            ),
          },
        ]}
      />
    </>
  );
};

export default TermsOfService;
