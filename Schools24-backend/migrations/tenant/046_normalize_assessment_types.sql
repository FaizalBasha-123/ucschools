-- Normalize existing assessment_type values to the new enum set.
-- Any value that is not already one of the eight standard codes gets mapped to 'FA-1'.
UPDATE assessments
SET assessment_type = 'FA-1'
WHERE assessment_type IS NULL
   OR assessment_type NOT IN ('FA-1','SA-1','FA-2','SA-2','FA-3','SA-3','FA-4','SA-4');
