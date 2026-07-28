-- ============================================================================
-- CareerOS — Supabase Storage buckets
-- Run after schema.sql. Each bucket is private; access is enforced by RLS
-- policies keyed on the first path segment being the user's own uid, e.g.
-- interview-recordings/<uid>/<filename>.
-- ============================================================================

insert into storage.buckets (id, name, public) values
  ('interview-recordings', 'interview-recordings', false),
  ('portfolio-evidence', 'portfolio-evidence', false),
  ('documents', 'documents', false),
  ('audio', 'audio', false),
  ('images', 'images', false),
  ('uploads', 'uploads', false)  -- catch-all for future upload types
on conflict (id) do nothing;

-- Owner-only access pattern for every bucket above: a user may read/write/
-- delete only objects whose path starts with their own uid.
do $$
declare
  b text;
  buckets text[] := array[
    'interview-recordings','portfolio-evidence','documents','audio','images','uploads'
  ];
begin
  foreach b in array buckets loop
    execute format(
      $p$create policy "%1$s owner select" on storage.objects
        for select using (bucket_id = '%1$s' and (storage.foldername(name))[1] = auth.uid()::text);$p$, b);
    execute format(
      $p$create policy "%1$s owner insert" on storage.objects
        for insert with check (bucket_id = '%1$s' and (storage.foldername(name))[1] = auth.uid()::text);$p$, b);
    execute format(
      $p$create policy "%1$s owner update" on storage.objects
        for update using (bucket_id = '%1$s' and (storage.foldername(name))[1] = auth.uid()::text);$p$, b);
    execute format(
      $p$create policy "%1$s owner delete" on storage.objects
        for delete using (bucket_id = '%1$s' and (storage.foldername(name))[1] = auth.uid()::text);$p$, b);
  end loop;
end $$;

-- Usage convention from the client (see storage.js):
--   path = `${user.id}/${crypto.randomUUID()}-${file.name}`
-- This is what makes the (storage.foldername(name))[1] = auth.uid() check work.
