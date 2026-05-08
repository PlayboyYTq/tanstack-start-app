ALTER TABLE public.statuses DROP CONSTRAINT statuses_kind_check;
ALTER TABLE public.statuses ADD CONSTRAINT statuses_kind_check CHECK (kind = ANY (ARRAY['image'::text, 'text'::text, 'video'::text]));