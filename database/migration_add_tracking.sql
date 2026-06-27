-- Migration: Add per-language tracking columns and audit trigger
-- Tracks who edited each language column and when, logs all changes to translation_history.
--
-- Run once against your PostgreSQL database:
--   psql $DATABASE_URL -f migration_add_tracking.sql

-- ─── 1. Per-language tracking columns ────────────────────────────────────────
ALTER TABLE public.translations
  ADD COLUMN IF NOT EXISTS en_updated_by  text,
  ADD COLUMN IF NOT EXISTS en_updated_at  timestamp with time zone,
  ADD COLUMN IF NOT EXISTS ar_updated_by  text,
  ADD COLUMN IF NOT EXISTS ar_updated_at  timestamp with time zone,
  ADD COLUMN IF NOT EXISTS es_updated_by  text,
  ADD COLUMN IF NOT EXISTS es_updated_at  timestamp with time zone,
  ADD COLUMN IF NOT EXISTS fr_updated_by  text,
  ADD COLUMN IF NOT EXISTS fr_updated_at  timestamp with time zone;

-- ─── 2. Fix translation_history language constraint to include 'fr' ───────────
ALTER TABLE public.translation_history
  DROP CONSTRAINT IF EXISTS translation_history_language_check;

ALTER TABLE public.translation_history
  ADD CONSTRAINT translation_history_language_check
    CHECK (language = ANY (ARRAY['en'::text, 'ar'::text, 'es'::text, 'fr'::text]));

-- ─── 3. Audit trigger function ────────────────────────────────────────────────
-- Reads two transaction-scoped session variables set by the application:
--   app.current_user  — username from JWT (or 'ai' / 'import')
--   app.change_type   — one of 'human_edited' | 'ai_generated' | 'bulk_import'
--
-- For each changed language column it:
--   • Inserts a row into translation_history with old/new values
--   • Sets {lang}_updated_by and {lang}_updated_at on the translations row
CREATE OR REPLACE FUNCTION public.log_translation_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_user        text;
  v_change_type text;
BEGIN
  v_user := COALESCE(
    NULLIF(current_setting('app.current_user', true), ''),
    current_user
  );
  v_change_type := COALESCE(
    NULLIF(current_setting('app.change_type', true), ''),
    'human_edited'
  );

  -- English
  IF OLD.en IS DISTINCT FROM NEW.en THEN
    INSERT INTO public.translation_history
      (translation_id, filename, language, old_value, new_value, changed_by, change_type)
    VALUES
      (NEW.id, NEW.filename, 'en', OLD.en, NEW.en, v_user, v_change_type);
    NEW.en_updated_by := v_user;
    NEW.en_updated_at := now();
  END IF;

  -- Arabic
  IF OLD.ar IS DISTINCT FROM NEW.ar THEN
    INSERT INTO public.translation_history
      (translation_id, filename, language, old_value, new_value, changed_by, change_type)
    VALUES
      (NEW.id, NEW.filename, 'ar', OLD.ar, NEW.ar, v_user, v_change_type);
    NEW.ar_updated_by := v_user;
    NEW.ar_updated_at := now();
  END IF;

  -- Spanish
  IF OLD.es IS DISTINCT FROM NEW.es THEN
    INSERT INTO public.translation_history
      (translation_id, filename, language, old_value, new_value, changed_by, change_type)
    VALUES
      (NEW.id, NEW.filename, 'es', OLD.es, NEW.es, v_user, v_change_type);
    NEW.es_updated_by := v_user;
    NEW.es_updated_at := now();
  END IF;

  -- French (source text edits)
  IF OLD.fr IS DISTINCT FROM NEW.fr THEN
    INSERT INTO public.translation_history
      (translation_id, filename, language, old_value, new_value, changed_by, change_type)
    VALUES
      (NEW.id, NEW.filename, 'fr', OLD.fr, NEW.fr, v_user, v_change_type);
    NEW.fr_updated_by := v_user;
    NEW.fr_updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.log_translation_changes() OWNER TO postgres;

-- ─── 4. Attach the trigger (runs BEFORE UPDATE, after updated_at trigger) ─────
DROP TRIGGER IF EXISTS trg_log_translation_changes ON public.translations;

CREATE TRIGGER trg_log_translation_changes
  BEFORE UPDATE ON public.translations
  FOR EACH ROW
  EXECUTE FUNCTION public.log_translation_changes();

-- ─── 5. Useful index for history lookups ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_translation_history_changed_at
  ON public.translation_history (changed_at DESC);
