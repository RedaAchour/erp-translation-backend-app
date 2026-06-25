-- Seed: default admin user
-- Username: admin / Password: admin
-- Change the password after first login!

INSERT INTO public.users (username, password_hash)
VALUES ('admin', '$2b$10$KH0hZYxOA.bNTDRBBnL3veHwCHMpMAl8KVtX.wauX5Pwb2r3yIF7i')
ON CONFLICT (username) DO NOTHING;
