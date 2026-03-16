-- NoMarkup: Tier 3 Vertical Platforms
-- 2 categories with subcategories and service types (3-level hierarchy)

-- ============================================================
-- HEALTHCARE — ELECTIVE
-- ============================================================

WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Healthcare — Elective', 'healthcare-elective', 1, 25, 'Elective dental, vision, cosmetic, therapy, and alternative medicine')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'Dental', 'health-dental', 2, 1),
  ((SELECT id FROM cat), 'Vision', 'health-vision', 2, 2),
  ((SELECT id FROM cat), 'Cosmetic', 'health-cosmetic', 2, 3),
  ((SELECT id FROM cat), 'Physical Therapy', 'health-physical-therapy', 2, 4),
  ((SELECT id FROM cat), 'Mental Health', 'health-mental', 2, 5),
  ((SELECT id FROM cat), 'Alternative Medicine', 'health-alternative', 2, 6);

-- Dental service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'health-dental')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Teeth Whitening', 'health-teeth-whitening', 3, 1),
  ((SELECT id FROM sub), 'Dental Veneers', 'health-dental-veneers', 3, 2),
  ((SELECT id FROM sub), 'Dental Implants', 'health-dental-implants', 3, 3),
  ((SELECT id FROM sub), 'Orthodontics & Aligners', 'health-orthodontics', 3, 4);

-- Vision service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'health-vision')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'LASIK Consultation', 'health-lasik', 3, 1),
  ((SELECT id FROM sub), 'Eye Exam', 'health-eye-exam', 3, 2),
  ((SELECT id FROM sub), 'Contact Lens Fitting', 'health-contact-fitting', 3, 3);

-- Cosmetic service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'health-cosmetic')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Botox & Fillers', 'health-botox-fillers', 3, 1),
  ((SELECT id FROM sub), 'Chemical Peels', 'health-chemical-peels', 3, 2),
  ((SELECT id FROM sub), 'Laser Hair Removal', 'health-laser-hair', 3, 3),
  ((SELECT id FROM sub), 'Microdermabrasion', 'health-microdermabrasion', 3, 4);

-- Physical Therapy service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'health-physical-therapy')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Sports Rehabilitation', 'health-sports-rehab', 3, 1),
  ((SELECT id FROM sub), 'Post-Surgery Recovery', 'health-post-surgery', 3, 2),
  ((SELECT id FROM sub), 'Chronic Pain Management', 'health-chronic-pain', 3, 3);

-- Mental Health service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'health-mental')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Individual Therapy', 'health-individual-therapy', 3, 1),
  ((SELECT id FROM sub), 'Couples Counseling', 'health-couples-counseling', 3, 2),
  ((SELECT id FROM sub), 'Stress & Anxiety Coaching', 'health-stress-anxiety', 3, 3);

-- Alternative Medicine service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'health-alternative')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Acupuncture', 'health-acupuncture', 3, 1),
  ((SELECT id FROM sub), 'Chiropractic Care', 'health-chiropractic', 3, 2),
  ((SELECT id FROM sub), 'Massage Therapy', 'health-massage', 3, 3),
  ((SELECT id FROM sub), 'Naturopathy', 'health-naturopathy', 3, 4);

-- ============================================================
-- COMMERCIAL CONSTRUCTION
-- ============================================================

WITH cat AS (
  INSERT INTO service_categories (name, slug, level, sort_order, description)
  VALUES ('Commercial Construction', 'commercial-construction', 1, 26, 'General contracting, commercial electrical, plumbing, HVAC, interior finishing, and site work')
  RETURNING id
)
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM cat), 'General Contracting', 'comcon-general', 2, 1),
  ((SELECT id FROM cat), 'Electrical (Commercial)', 'comcon-electrical', 2, 2),
  ((SELECT id FROM cat), 'Plumbing (Commercial)', 'comcon-plumbing', 2, 3),
  ((SELECT id FROM cat), 'HVAC (Commercial)', 'comcon-hvac', 2, 4),
  ((SELECT id FROM cat), 'Interior Finishing', 'comcon-interior', 2, 5),
  ((SELECT id FROM cat), 'Site Work', 'comcon-site-work', 2, 6);

-- General Contracting service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'comcon-general')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'New Construction', 'comcon-new-construction', 3, 1),
  ((SELECT id FROM sub), 'Tenant Build-Out', 'comcon-tenant-buildout', 3, 2),
  ((SELECT id FROM sub), 'Renovation & Remodel', 'comcon-renovation', 3, 3),
  ((SELECT id FROM sub), 'Project Management', 'comcon-project-mgmt', 3, 4);

-- Electrical (Commercial) service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'comcon-electrical')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Commercial Wiring', 'comcon-commercial-wiring', 3, 1),
  ((SELECT id FROM sub), 'Panel & Switchgear', 'comcon-panel-switchgear', 3, 2),
  ((SELECT id FROM sub), 'Emergency & Exit Lighting', 'comcon-emergency-lighting', 3, 3);

-- Plumbing (Commercial) service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'comcon-plumbing')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Commercial Pipe Installation', 'comcon-pipe-install', 3, 1),
  ((SELECT id FROM sub), 'Backflow Prevention', 'comcon-backflow', 3, 2),
  ((SELECT id FROM sub), 'Grease Trap Installation', 'comcon-grease-trap', 3, 3);

-- HVAC (Commercial) service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'comcon-hvac')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Rooftop Unit Installation', 'comcon-rtu-install', 3, 1),
  ((SELECT id FROM sub), 'Commercial Duct Installation', 'comcon-duct-install', 3, 2),
  ((SELECT id FROM sub), 'Building Automation Systems', 'comcon-building-auto', 3, 3),
  ((SELECT id FROM sub), 'Chiller & Boiler Installation', 'comcon-chiller-boiler', 3, 4);

-- Interior Finishing service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'comcon-interior')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Drywall & Framing', 'comcon-drywall-framing', 3, 1),
  ((SELECT id FROM sub), 'Commercial Flooring', 'comcon-flooring', 3, 2),
  ((SELECT id FROM sub), 'Acoustic Ceiling Installation', 'comcon-acoustic-ceiling', 3, 3),
  ((SELECT id FROM sub), 'Commercial Painting', 'comcon-painting', 3, 4);

-- Site Work service types
WITH sub AS (SELECT id FROM service_categories WHERE slug = 'comcon-site-work')
INSERT INTO service_categories (parent_id, name, slug, level, sort_order) VALUES
  ((SELECT id FROM sub), 'Excavation & Grading', 'comcon-excavation', 3, 1),
  ((SELECT id FROM sub), 'Paving & Asphalt', 'comcon-paving', 3, 2),
  ((SELECT id FROM sub), 'Utility Trenching', 'comcon-utility-trench', 3, 3);
