-- =====================================================================
-- 0005 — card-images storage bucket (Phase 2)
-- =====================================================================
-- Public-read bucket that caches Scryfall card art. The cache is
-- shared across all users: object names are deterministic
-- (`scryfall/<scryfall_id>.jpg`), so once anyone has uploaded a card
-- image, every other user's deck builder just reuses the same URL.
--
-- Why proxy instead of hot-linking Scryfall directly? Two reasons:
--   1. Resilience to Scryfall outages or art-URL changes.
--   2. We control caching headers / CDN behaviour.
--
-- Trade-off: we pay storage cost (~50 KB per card, ~5 MB per deck)
-- and deck building gets a one-time upload step per new card.
-- =====================================================================


-- Create the bucket. file_size_limit caps a single object at 2 MB —
-- Scryfall "normal" images are ~50-100 KB so this is generous.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-images',
  'card-images',
  true,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- ---------------------------------------------------------------------
-- RLS on storage.objects, scoped to this bucket
-- ---------------------------------------------------------------------
-- Public buckets serve files at a public URL without RLS, but the
-- policies below still gate the *programmatic* API (list, insert,
-- update). DELETE is intentionally absent — only service_role can
-- prune the cache, so a logged-in user can't sabotage other users'
-- decks by deleting cached images.

create policy "card-images: public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'card-images');

create policy "card-images: authenticated insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'card-images');

create policy "card-images: authenticated update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'card-images')
  with check (bucket_id = 'card-images');
