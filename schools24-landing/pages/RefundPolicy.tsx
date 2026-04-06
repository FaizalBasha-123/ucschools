import React from 'react';
import SEOMeta from '../components/SEOMeta';
import LegalPageShell from '../components/LegalPageShell';

const RefundPolicy: React.FC = () => {
  return (
    <>
      <SEOMeta
        title="Refund Policy – MySchools"
        description="Review how MySchools handles refunds, subscription reversals, onboarding cancellations, and billing adjustments for institutional customers."
        path="/refund-policy"
      />
      <LegalPageShell
        eyebrow="Legal"
        title="Refund / Cancellation Policy"
        description="This policy outlines how MySchools handles subscription cancellations, refund eligibility, and commercial reversals for institutional customers."
        sections={[
          {
            heading: 'Refund Eligibility',
            body: (
              <>
                <p>
                  Refund requests may be considered where payment was made in error, where the service has not been provisioned in line with the agreed onboarding scope, or where a contractual commitment specifically allows reversal. Approval depends on review of the applicable proposal, invoice, activation status, and service-delivery record.
                </p>
              </>
            ),
          },
          {
            heading: 'Cancellation Timeline',
            body: (
              <>
                <p>
                  Schools seeking cancellation should notify MySchools through the designated commercial or support channel within the timeline stated in the applicable subscription or onboarding agreement. Requests made after material onboarding, deployment, migration, training, or service consumption may be treated differently from pre-activation cancellations.
                </p>
              </>
            ),
          },
          {
            heading: 'Non-Refundable Cases',
            body: (
              <>
                <p>
                  Fees may be non-refundable where platform access has been activated, onboarding work has substantially commenced, customized implementation work has been delivered, third-party costs have already been incurred, or the governing commercial document explicitly identifies the amount as non-refundable.
                </p>
              </>
            ),
          },
        ]}
      />
    </>
  );
};

export default RefundPolicy;
