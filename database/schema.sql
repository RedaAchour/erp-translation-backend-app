--
-- PostgreSQL database dump
--

\restrict deJy63DbMMzpGZ5g5g3jpD047EzmRcNVSGuqKWHLtEUGcWEc4Fw0da1fivjeB4G

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

-- Started on 2026-03-31 09:02:30

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 222 (class 1255 OID 16408)
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_updated_at_column() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 221 (class 1259 OID 16411)
-- Name: translation_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.translation_history (
    id integer NOT NULL,
    translation_id text NOT NULL,
    filename text NOT NULL,
    language text NOT NULL,
    old_value text,
    new_value text,
    changed_by text,
    change_type text,
    changed_at timestamp with time zone DEFAULT now(),
    CONSTRAINT translation_history_change_type_check CHECK ((change_type = ANY (ARRAY['ai_generated'::text, 'human_edited'::text, 'bulk_import'::text]))),
    CONSTRAINT translation_history_language_check CHECK ((language = ANY (ARRAY['en'::text, 'ar'::text, 'es'::text])))
);


ALTER TABLE public.translation_history OWNER TO postgres;

--
-- TOC entry 220 (class 1259 OID 16410)
-- Name: translation_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.translation_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.translation_history_id_seq OWNER TO postgres;

--
-- TOC entry 4933 (class 0 OID 0)
-- Dependencies: 220
-- Name: translation_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.translation_history_id_seq OWNED BY public.translation_history.id;


--
-- TOC entry 219 (class 1259 OID 16388)
-- Name: translations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.translations (
    id text NOT NULL,
    filename text NOT NULL,
    fr text,
    en text,
    ar text,
    es text,
    link text,
    status text DEFAULT 'pending'::text,
    en_validated boolean DEFAULT false,
    ar_validated boolean DEFAULT false,
    es_validated boolean DEFAULT false,
    context text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    validated_by text,
    validated_at timestamp with time zone,
    CONSTRAINT translations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ai_translated'::text, 'human_reviewed'::text, 'approved'::text, 'needs_review'::text])))
);


ALTER TABLE public.translations OWNER TO postgres;

--
-- TOC entry 4766 (class 2604 OID 16414)
-- Name: translation_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.translation_history ALTER COLUMN id SET DEFAULT nextval('public.translation_history_id_seq'::regclass);


--
-- TOC entry 4778 (class 2606 OID 16425)
-- Name: translation_history translation_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.translation_history
    ADD CONSTRAINT translation_history_pkey PRIMARY KEY (id);


--
-- TOC entry 4775 (class 2606 OID 16404)
-- Name: translations translations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.translations
    ADD CONSTRAINT translations_pkey PRIMARY KEY (id, filename);


--
-- TOC entry 4776 (class 1259 OID 16431)
-- Name: idx_translation_history_lookup; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_translation_history_lookup ON public.translation_history USING btree (translation_id, filename);


--
-- TOC entry 4771 (class 1259 OID 16407)
-- Name: idx_translations_context; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_translations_context ON public.translations USING btree (context);


--
-- TOC entry 4772 (class 1259 OID 16405)
-- Name: idx_translations_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_translations_status ON public.translations USING btree (status);


--
-- TOC entry 4773 (class 1259 OID 16406)
-- Name: idx_translations_validation; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_translations_validation ON public.translations USING btree (en_validated, ar_validated, es_validated);


--
-- TOC entry 4780 (class 2620 OID 16409)
-- Name: translations update_translations_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER update_translations_updated_at BEFORE UPDATE ON public.translations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- TOC entry 4779 (class 2606 OID 16426)
-- Name: translation_history translation_history_translation_id_filename_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.translation_history
    ADD CONSTRAINT translation_history_translation_id_filename_fkey FOREIGN KEY (translation_id, filename) REFERENCES public.translations(id, filename) ON DELETE CASCADE;


-- Completed on 2026-03-31 09:02:31

--
-- PostgreSQL database dump complete
--

\unrestrict deJy63DbMMzpGZ5g5g3jpD047EzmRcNVSGuqKWHLtEUGcWEc4Fw0da1fivjeB4G

