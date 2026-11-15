CREATE TABLE IF NOT EXISTS public.sri_lanka_comments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  section text NOT NULL,
  author text NOT NULL CHECK (author IN ('Maria', 'Apostolis', 'Giannis')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  quote text NOT NULL DEFAULT '' CHECK (length(quote) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sri_lanka_comments_section_id ON public.sri_lanka_comments (section, id);

CREATE TABLE IF NOT EXISTS public.sri_lanka_answers (
  id integer PRIMARY KEY CHECK (id = 1),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 0
);

ALTER TABLE public.sri_lanka_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sri_lanka_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sri_lanka_comments, public.sri_lanka_answers FROM anon, authenticated;
GRANT SELECT, INSERT ON public.sri_lanka_comments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sri_lanka_comments_id_seq TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.sri_lanka_answers TO service_role;

CREATE OR REPLACE FUNCTION public.sri_lanka_save_answers(new_answers jsonb, expected_revision integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE saved_revision integer;
BEGIN
  INSERT INTO public.sri_lanka_answers (id) VALUES (1) ON CONFLICT DO NOTHING;
  UPDATE public.sri_lanka_answers
  SET answers = new_answers, revision = revision + 1
  WHERE id = 1 AND revision = expected_revision
  RETURNING revision INTO saved_revision;
  RETURN saved_revision;
END;
$$;
REVOKE ALL ON FUNCTION public.sri_lanka_save_answers(jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sri_lanka_save_answers(jsonb, integer) TO service_role;
