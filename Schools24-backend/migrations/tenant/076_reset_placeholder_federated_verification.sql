UPDATE students
SET
    apaar_verified_at = NULL,
    abc_verified_at = NULL,
    identity_verification_status = CASE
        WHEN NULLIF(TRIM(COALESCE(apaar_id, '')), '') IS NOT NULL
          OR NULLIF(TRIM(COALESCE(abc_id, '')), '') IS NOT NULL
            THEN 'pending_external_verification'
        ELSE 'unverified'
    END
WHERE apaar_verified_at IS NOT NULL
   OR abc_verified_at IS NOT NULL
   OR COALESCE(identity_verification_status, '') IN ('verified', 'partial');
