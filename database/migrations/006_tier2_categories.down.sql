-- Rollback: remove Tier 2 Professional Services categories
-- Delete children first (level 3), then subcategories (level 2), then top-level (level 1)

-- LEGAL SERVICES
DELETE FROM service_categories WHERE slug IN (
  'legal-will-trust', 'legal-llc-formation', 'legal-lease-draft',
  'legal-business-consult', 'legal-family-consult', 'legal-realestate-consult',
  'legal-employment-review', 'legal-vendor-review',
  'legal-filing-assist', 'legal-court-rep',
  'legal-dispute-mediation', 'legal-divorce-mediation', 'legal-workplace-mediation'
);
DELETE FROM service_categories WHERE slug IN (
  'legal-doc-prep', 'legal-consultation', 'legal-contract-review', 'legal-small-claims', 'legal-mediation'
);
DELETE FROM service_categories WHERE slug = 'legal';

-- ACCOUNTING & TAX PREP
DELETE FROM service_categories WHERE slug IN (
  'acct-individual-tax', 'acct-business-tax', 'acct-tax-amendment',
  'acct-monthly-books', 'acct-catchup-books',
  'acct-payroll-process', 'acct-payroll-tax',
  'acct-retirement-plan', 'acct-investment-advisory', 'acct-estate-plan',
  'acct-financial-audit', 'acct-compliance-audit'
);
DELETE FROM service_categories WHERE slug IN (
  'acct-tax-prep', 'acct-bookkeeping', 'acct-payroll', 'acct-financial-planning', 'acct-audit'
);
DELETE FROM service_categories WHERE slug = 'accounting-tax';

-- EVENT SERVICES
DELETE FROM service_categories WHERE slug IN (
  'event-wedding-plan', 'event-corporate-plan', 'event-birthday-plan', 'event-fundraiser-plan',
  'event-buffet-cater', 'event-plated-dinner', 'event-cocktail-cater',
  'event-photography', 'event-videography', 'event-photo-booth', 'event-drone-footage',
  'event-dj', 'event-live-band', 'event-performer',
  'event-tent-setup', 'event-table-chair', 'event-lighting-decor', 'event-stage-av'
);
DELETE FROM service_categories WHERE slug IN (
  'event-planning', 'event-catering', 'event-photo-video', 'event-entertainment', 'event-venue-setup'
);
DELETE FROM service_categories WHERE slug = 'event-services';

-- TUTORING & EDUCATION
DELETE FROM service_categories WHERE slug IN (
  'tutor-math', 'tutor-science', 'tutor-english', 'tutor-history',
  'tutor-sat-act', 'tutor-gre-gmat', 'tutor-lsat-mcat',
  'tutor-piano', 'tutor-guitar', 'tutor-voice', 'tutor-drawing-painting',
  'tutor-spanish', 'tutor-french', 'tutor-mandarin', 'tutor-esl',
  'tutor-public-speaking', 'tutor-career-coaching', 'tutor-resume-interview'
);
DELETE FROM service_categories WHERE slug IN (
  'tutor-academic', 'tutor-test-prep', 'tutor-music-arts', 'tutor-language', 'tutor-professional'
);
DELETE FROM service_categories WHERE slug = 'tutoring';
