-- Statuses (24h ephemeral updates)
CREATE TABLE IF NOT EXISTS public.statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image','text')),
  media_url text,
  content text,
  background text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_statuses_user_created ON public.statuses (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_statuses_expires ON public.statuses (expires_at);

ALTER TABLE public.statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own status"
ON public.statuses FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own status"
ON public.statuses FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own status"
ON public.statuses FOR DELETE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Friends and self can view statuses"
ON public.statuses FOR SELECT TO authenticated
USING (
  expires_at > now()
  AND (
    user_id = auth.uid()
    OR public.are_friends(auth.uid(), user_id)
  )
);

-- Status views
CREATE TABLE IF NOT EXISTS public.status_views (
  status_id uuid NOT NULL REFERENCES public.statuses(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (status_id, viewer_id)
);

ALTER TABLE public.status_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can record their own views"
ON public.status_views FOR INSERT TO authenticated
WITH CHECK (auth.uid() = viewer_id);

CREATE POLICY "Viewer or status owner can see views"
ON public.status_views FOR SELECT TO authenticated
USING (
  auth.uid() = viewer_id
  OR EXISTS (SELECT 1 FROM public.statuses s WHERE s.id = status_id AND s.user_id = auth.uid())
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.statuses;