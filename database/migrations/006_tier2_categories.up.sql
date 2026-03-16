-- NoMarkup: Tier 2 Professional Services
-- 4 categories with subcategories and service types (3-level hierarchy)

-- ============================================================
-- LEGAL SERVICES
-- ============================================================

WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Legal Services', 'legal', 1, 21, 'Document preparation, consultation, contracts, and mediation')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Document Preparation', 'legal-doc-prep', 2, 1),
  ((SELECT id FROM cat), 'Consultation', 'legal-consultation', 2, 2),
  ((SELECT id FROM cat), 'Contract Review', 'legal-contract-review', 2, 3),
  ((SELECT id FROM cat), 'Small Claims', 'legal-small-claims', 2, 4),
  ((SELECT id FROM cat), 'Mediation', 'legal-mediation', 2, 5);

-- Document Preparation service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'legal-doc-prep')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Will & Trust Drafting', 'legal-will-trust', 3, 1),
  ((SELECT id FROM sub), 'LLC Formation', 'legal-llc-formation', 3, 2),
  ((SELECT id FROM sub), 'Lease Agreement Drafting', 'legal-lease-draft', 3, 3);

-- Consultation service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'legal-consultation')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Business Law Consultation', 'legal-business-consult', 3, 1),
  ((SELECT id FROM sub), 'Family Law Consultation', 'legal-family-consult', 3, 2),
  ((SELECT id FROM sub), 'Real Estate Law Consultation', 'legal-realestate-consult', 3, 3);

-- Contract Review service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'legal-contract-review')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Employment Contract Review', 'legal-employment-review', 3, 1),
  ((SELECT id FROM sub), 'Vendor Contract Review', 'legal-vendor-review', 3, 2);

-- Small Claims service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'legal-small-claims')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Filing Assistance', 'legal-filing-assist', 3, 1),
  ((SELECT id FROM sub), 'Court Representation', 'legal-court-rep', 3, 2);

-- Mediation service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'legal-mediation')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Dispute Mediation', 'legal-dispute-mediation', 3, 1),
  ((SELECT id FROM sub), 'Divorce Mediation', 'legal-divorce-mediation', 3, 2),
  ((SELECT id FROM sub), 'Workplace Mediation', 'legal-workplace-mediation', 3, 3);

-- ============================================================
-- ACCOUNTING & TAX PREP
-- ============================================================

WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Accounting & Tax Prep', 'accounting-tax', 1, 22, 'Tax preparation, bookkeeping, payroll, and financial planning')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Tax Preparation', 'acct-tax-prep', 2, 1),
  ((SELECT id FROM cat), 'Bookkeeping', 'acct-bookkeeping', 2, 2),
  ((SELECT id FROM cat), 'Payroll', 'acct-payroll', 2, 3),
  ((SELECT id FROM cat), 'Financial Planning', 'acct-financial-planning', 2, 4),
  ((SELECT id FROM cat), 'Audit', 'acct-audit', 2, 5);

-- Tax Preparation service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'acct-tax-prep')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Individual Tax Filing', 'acct-individual-tax', 3, 1),
  ((SELECT id FROM sub), 'Business Tax Filing', 'acct-business-tax', 3, 2),
  ((SELECT id FROM sub), 'Tax Amendment', 'acct-tax-amendment', 3, 3);

-- Bookkeeping service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'acct-bookkeeping')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Monthly Bookkeeping', 'acct-monthly-books', 3, 1),
  ((SELECT id FROM sub), 'Catch-Up Bookkeeping', 'acct-catchup-books', 3, 2);

-- Payroll service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'acct-payroll')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Payroll Processing', 'acct-payroll-process', 3, 1),
  ((SELECT id FROM sub), 'Payroll Tax Filing', 'acct-payroll-tax', 3, 2);

-- Financial Planning service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'acct-financial-planning')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Retirement Planning', 'acct-retirement-plan', 3, 1),
  ((SELECT id FROM sub), 'Investment Advisory', 'acct-investment-advisory', 3, 2),
  ((SELECT id FROM sub), 'Estate Planning', 'acct-estate-plan', 3, 3);

-- Audit service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'acct-audit')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Financial Statement Audit', 'acct-financial-audit', 3, 1),
  ((SELECT id FROM sub), 'Compliance Audit', 'acct-compliance-audit', 3, 2);

-- ============================================================
-- EVENT SERVICES
-- ============================================================

WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Event Services', 'event-services', 1, 23, 'Event planning, catering, photography, entertainment, and venue setup')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Event Planning', 'event-planning', 2, 1),
  ((SELECT id FROM cat), 'Catering', 'event-catering', 2, 2),
  ((SELECT id FROM cat), 'Photography & Video', 'event-photo-video', 2, 3),
  ((SELECT id FROM cat), 'Entertainment', 'event-entertainment', 2, 4),
  ((SELECT id FROM cat), 'Venue Setup', 'event-venue-setup', 2, 5);

-- Event Planning service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'event-planning')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Wedding Planning', 'event-wedding-plan', 3, 1),
  ((SELECT id FROM sub), 'Corporate Event Planning', 'event-corporate-plan', 3, 2),
  ((SELECT id FROM sub), 'Birthday Party Planning', 'event-birthday-plan', 3, 3),
  ((SELECT id FROM sub), 'Fundraiser Planning', 'event-fundraiser-plan', 3, 4);

-- Catering service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'event-catering')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Buffet Catering', 'event-buffet-cater', 3, 1),
  ((SELECT id FROM sub), 'Plated Dinner Service', 'event-plated-dinner', 3, 2),
  ((SELECT id FROM sub), 'Cocktail & Appetizer Service', 'event-cocktail-cater', 3, 3);

-- Photography & Video service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'event-photo-video')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Event Photography', 'event-photography', 3, 1),
  ((SELECT id FROM sub), 'Event Videography', 'event-videography', 3, 2),
  ((SELECT id FROM sub), 'Photo Booth Rental', 'event-photo-booth', 3, 3),
  ((SELECT id FROM sub), 'Drone Aerial Footage', 'event-drone-footage', 3, 4);

-- Entertainment service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'event-entertainment')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'DJ Services', 'event-dj', 3, 1),
  ((SELECT id FROM sub), 'Live Band', 'event-live-band', 3, 2),
  ((SELECT id FROM sub), 'Magician & Performer', 'event-performer', 3, 3);

-- Venue Setup service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'event-venue-setup')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Tent & Canopy Setup', 'event-tent-setup', 3, 1),
  ((SELECT id FROM sub), 'Table & Chair Rental', 'event-table-chair', 3, 2),
  ((SELECT id FROM sub), 'Lighting & Decor Setup', 'event-lighting-decor', 3, 3),
  ((SELECT id FROM sub), 'Stage & AV Setup', 'event-stage-av', 3, 4);

-- ============================================================
-- TUTORING & EDUCATION
-- ============================================================

WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Tutoring & Education', 'tutoring', 1, 24, 'Academic tutoring, test prep, music, language, and professional development')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Academic Tutoring', 'tutor-academic', 2, 1),
  ((SELECT id FROM cat), 'Test Prep', 'tutor-test-prep', 2, 2),
  ((SELECT id FROM cat), 'Music & Arts', 'tutor-music-arts', 2, 3),
  ((SELECT id FROM cat), 'Language', 'tutor-language', 2, 4),
  ((SELECT id FROM cat), 'Professional Development', 'tutor-professional', 2, 5);

-- Academic Tutoring service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'tutor-academic')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Math Tutoring', 'tutor-math', 3, 1),
  ((SELECT id FROM sub), 'Science Tutoring', 'tutor-science', 3, 2),
  ((SELECT id FROM sub), 'English & Writing Tutoring', 'tutor-english', 3, 3),
  ((SELECT id FROM sub), 'History & Social Studies', 'tutor-history', 3, 4);

-- Test Prep service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'tutor-test-prep')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'SAT/ACT Prep', 'tutor-sat-act', 3, 1),
  ((SELECT id FROM sub), 'GRE/GMAT Prep', 'tutor-gre-gmat', 3, 2),
  ((SELECT id FROM sub), 'LSAT/MCAT Prep', 'tutor-lsat-mcat', 3, 3);

-- Music & Arts service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'tutor-music-arts')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Piano Lessons', 'tutor-piano', 3, 1),
  ((SELECT id FROM sub), 'Guitar Lessons', 'tutor-guitar', 3, 2),
  ((SELECT id FROM sub), 'Voice Lessons', 'tutor-voice', 3, 3),
  ((SELECT id FROM sub), 'Drawing & Painting Lessons', 'tutor-drawing-painting', 3, 4);

-- Language service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'tutor-language')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Spanish Lessons', 'tutor-spanish', 3, 1),
  ((SELECT id FROM sub), 'French Lessons', 'tutor-french', 3, 2),
  ((SELECT id FROM sub), 'Mandarin Lessons', 'tutor-mandarin', 3, 3),
  ((SELECT id FROM sub), 'ESL Tutoring', 'tutor-esl', 3, 4);

-- Professional Development service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'tutor-professional')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Public Speaking Coaching', 'tutor-public-speaking', 3, 1),
  ((SELECT id FROM sub), 'Career Coaching', 'tutor-career-coaching', 3, 2),
  ((SELECT id FROM sub), 'Resume & Interview Prep', 'tutor-resume-interview', 3, 3);
