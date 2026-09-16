INSERT INTO users (full_name, agency, email, role, password_hash, password_salt, trial_ends_at, created_at)
VALUES
  ('Avery Dispatcher', 'ProcessServe Agency', 'admin@processserve.demo', 'agency_admin', '0096e16a7975c85f3571cb5cdc21c7597d55ed57f2f97d21185a970632a6df4e', 'seed-agency-admin', datetime('now', '+30 day'), datetime('now')),
  ('Jordan Server', 'ProcessServe Agency', 'server@processserve.demo', 'process_server', 'f5e00cc49b2867afb461e05d5a8b0ff009d3b3580edee8aefaab2cf27b3aa483', 'seed-process-server', datetime('now', '+30 day'), datetime('now')),
  ('Cameron Client', 'Northstar Law Firm', 'client@northstarlaw.demo', 'client', 'b4f3fba7837db7574778d1f84139b5762301aff3bae8a536737871ac6b2557f6', 'seed-client', datetime('now', '+30 day'), datetime('now'));

INSERT INTO orders (title, details, status, deadline, client_id, created_by, assigned_server_id, archived, created_at, updated_at)
VALUES
  ('Serve summons - Smith v. Rivera', 'Primary residence service with evening attempt preference.', 'assigned', datetime('now', '+5 day'), 3, 1, 2, 0, datetime('now', '-1 day'), datetime('now', '-1 day')),
  ('Subpoena delivery - Apex Contracting', 'Office drop-off and signed receipt required.', 'attempted', datetime('now', '+2 day'), 3, 1, 2, 0, datetime('now', '-3 day'), datetime('now', '-1 hour'));

INSERT INTO attempts (order_id, user_id, gps_lat, gps_lng, notes, physical_description, timeline_note, evidence_url, created_at)
VALUES
  (2, 2, 34.0522, -118.2437, 'No answer at front desk; card left with receptionist.', 'Receptionist: female, mid-40s, black jacket.', 'First business-hours attempt', 'r2://processserver-evidence/sample-attempt-2-photo.jpg', datetime('now', '-1 hour'));

INSERT INTO notifications (user_id, order_id, message, channel, created_at)
VALUES
  (3, 2, 'Order #2 has a new field attempt log.', 'in_app', datetime('now', '-55 minutes')),
  (3, 2, '[EMAIL STUB] Order #2 has a new field attempt log.', 'email_stub', datetime('now', '-55 minutes')),
  (1, 1, 'Order #1 is assigned and active.', 'in_app', datetime('now', '-1 day'));
