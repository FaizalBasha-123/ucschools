import React from 'react';
import SEOMeta from '../components/SEOMeta';
import LegalPageShell from '../components/LegalPageShell';

const IntellectualProperty: React.FC = () => {
  return (
    <>
      <SEOMeta
        title="Copyright & Intellectual Property Policy – MySchools"
        description="Read the MySchools policy on ownership of platform materials, branding, software, and restricted use of proprietary content."
        path="/intellectual-property"
      />
      <LegalPageShell
        eyebrow="Legal"
        title="Copyright / Intellectual Property Policy"
        description="This policy explains ownership and permitted use of MySchools software, branding, documents, website content, and related intellectual property."
        sections={[
          {
            heading: 'Ownership',
            body: (
              <>
                <p>
                  Unless otherwise stated in writing, MySchools platform software, website content, product documentation, branding, graphics, and related materials remain the intellectual property of MySchools or its licensors.
                </p>
              </>
            ),
          },
          {
            heading: 'Restricted Use',
            body: (
              <>
                <p>
                  No party may reproduce, modify, reverse engineer, republish, commercially exploit, or distribute MySchools proprietary materials except as expressly permitted under an applicable written agreement or with prior written authorization.
                </p>
              </>
            ),
          },
        ]}
      />
    </>
  );
};

export default IntellectualProperty;
