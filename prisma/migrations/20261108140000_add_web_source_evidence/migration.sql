-- Public GitHub and portfolio scans write candidate evidence. The enum is
-- extended in its own migration so later migrations can use the values.
ALTER TYPE "CareerEvidenceSource" ADD VALUE IF NOT EXISTS 'GITHUB_IMPORT_CANDIDATE';
ALTER TYPE "CareerEvidenceSource" ADD VALUE IF NOT EXISTS 'PORTFOLIO_IMPORT_CANDIDATE';
