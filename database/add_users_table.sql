-- Migration: Add users table for authentication
-- Run this against your PostgreSQL database to add authentication support.

CREATE TABLE public.users (
    id          serial PRIMARY KEY,
    username    text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at  timestamp with time zone DEFAULT now(),
    updated_at  timestamp with time zone DEFAULT now()
);

ALTER TABLE public.users OWNER TO postgres;

CREATE INDEX idx_users_username ON public.users USING btree (username);

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
