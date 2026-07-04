-- Adds cloud image support: expense photos and group cover images are
-- stored in the public equo-images storage bucket; rows keep the URL.
alter table public.groups add column if not exists cover_image_url text;
alter table public.expenses add column if not exists image_url text;

insert into storage.buckets (id, name, public)
values ('equo-images', 'equo-images', true)
on conflict (id) do nothing;
