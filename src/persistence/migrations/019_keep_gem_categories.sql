-- New installs start with a few example words and categories (13 Oct 2026),
-- not one office's full lists. Settings saved before then that never chose
-- their own GeM categories were using the old starting list without saving
-- it: save it now, so the change never touches an office already working.
-- Runs once, on upgrade; a new install has no saved settings yet.
UPDATE app_settings SET value_json = json_set(value_json, '$.categoriesByPortal', json('{}'))
WHERE key = 'run_defaults' AND json_type(value_json, '$.categoriesByPortal') IS NULL;
UPDATE app_settings SET value_json = json_set(value_json, '$.categoriesByPortal.gem', json_array(
  'Custom Bid For Services',
  'Application Development',
  'Application Development And Maintenance Resource Hiring Services',
  'Hiring Of Professionals For Application Development And Maintenance - Data Science And Analytics Role; Data Analyst; 3 Years And Less Than 6 Years',
  'E-learning Content Development - Non-igot; Restructure & Rewrite Content, Storyboarding With Production Support; Hindi, English, Tamil, Kannada, Telugu, Bengali, Assamese; Mobile And Laptop/desktop Both; Textiles & Clothing; Type Of Content; Na; Refe..',
  'Interactive Content Creation Services',
  'Software Support Services 2.0 - Microsoft; Operating System Software; Maintenance Services; Not Applicable; General Service Provider',
  'Hiring Of Agency For It Projects- Milestone Basis',
  'Design, Development, Implementation, And Maintenance Of Websites, Web Portal, Web-enabled Application And Mobile Apps - Open Source Solution (oss)',
  'Web/mobile Based Ar/vr Or Ar/vr Related Application Development'
))
WHERE key = 'run_defaults' AND json_type(value_json, '$.categoriesByPortal.gem') IS NULL;
