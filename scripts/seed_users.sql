-- TrioTect seed: users (identity-db)
-- Bcrypt hashes (cost=12) generated with passlib CryptContext(schemes=['bcrypt']):
--   ADMIN-001  → AdminPass123!
--   210041001  → Student1Pass!
--   210041002  → Student2Pass!
--   210041003  → Student3Pass!
--   210041004  → Student4Pass!
--   210041005  → Student5Pass!
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
INSERT INTO users (id, student_id, email, hashed_password, full_name, is_admin, is_active, created_at, updated_at)
SELECT gen_random_uuid()::text, sid, email, hash, name, admin, true, NOW(), NOW()
FROM (VALUES
    ('ADMIN-001',  'admin@iut.edu.bd',    '$2b$12$RMwKPfh.wWtHkxnboZDK7.WTZ5gj8sFNvAUlurlBCpjdndqGRDaWC', 'IUT Cafeteria Admin', true),
    ('210041001', 'student1@iut.edu.bd', '$2b$12$E1A931eX/sRX6LMQTv/B.ukFHxGWqqFJEMtqYIRlGvoHEV2LNSf5O', 'Student 1',           false),
    ('210041002', 'student2@iut.edu.bd', '$2b$12$VJ6DfW3bzwWTEjRIrXNuzu43CdbJYNfF2YaFyxI.EwXE4qyPSuwh.', 'Student 2',           false),
    ('210041003', 'student3@iut.edu.bd', '$2b$12$WiUMYdKyVvcPSvQeVdfFL.ornsiiIyOjMLWcP991vuVwOVGqmZGmK', 'Student 3',           false),
    ('210041004', 'student4@iut.edu.bd', '$2b$12$lylinSN5MXFEaXmIjS.J7OeTLFil.xLYR3wMneMfbwo0LdzXkKiMC', 'Student 4',           false),
    ('210041005', 'student5@iut.edu.bd', '$2b$12$aTWEmbveFl6X6bD0GF4gd.JcvBCKgjF4aguqYtgcQTMsP6LkKMG5K', 'Student 5',           false)
) AS t(sid, email, hash, name, admin)
ON CONFLICT (student_id) DO UPDATE SET hashed_password = EXCLUDED.hashed_password;
SELECT student_id, full_name, is_admin FROM users ORDER BY is_admin DESC, student_id;
