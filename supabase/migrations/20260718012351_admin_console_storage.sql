-- Admin console: storage bucket stats (object count, total size, orphans).
--
-- The equo-images bucket is written by the app (expense photos, group covers,
-- avatars) and cleaned by fire-and-forget delete hooks in softDeleteExpense /
-- updateGroup / updateUserAvatar. Those hooks swallow their own failures, so a
-- failed delete leaves an object nothing references - and today the admin
-- console has no way to notice. This read-only RPC surfaces the totals and,
-- crucially, the orphan count so a slow leak becomes visible before it matters.
--
-- An orphan is a bucket object whose public URL is referenced by no row in any
-- of the image-URL columns. Matching is by the storage path (everything after
-- '/equo-images/'), which is what our own public URLs embed; foreign URLs (a
-- googleusercontent.com avatar) simply never match an object, which is correct.
--
-- SECURITY DEFINER so it can read storage.objects (owned by the storage role);
-- EXECUTE is granted to service_role only, like every other admin_console_* fn.
CREATE OR REPLACE FUNCTION "public"."admin_console_storage"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  with referenced as (
    select distinct substring(url from '/equo-images/(.*)$') as path
    from (
      select image_url as url from expenses where image_url is not null
      union all select receipt_image_url from expenses where receipt_image_url is not null
      union all select cover_image_url from groups where cover_image_url is not null
      union all select image_url from groups where image_url is not null
      union all select avatar_url from users where avatar_url is not null
      union all select photo_url from group_members where photo_url is not null
      union all select avatar_url from profiles where avatar_url is not null
    ) u
    where url like '%/equo-images/%'
  ),
  objects as (
    select o.name, coalesce((o.metadata ->> 'size')::bigint, 0) as bytes,
      o.name not in (select path from referenced where path is not null) as is_orphan
    from storage.objects o
    where o.bucket_id = 'equo-images'
  )
  select jsonb_build_object(
    'object_count', (select count(*) from objects),
    'total_bytes', (select coalesce(sum(bytes), 0) from objects),
    'orphan_count', (select count(*) from objects where is_orphan),
    'orphan_bytes', (select coalesce(sum(bytes), 0) from objects where is_orphan)
  );
$$;


ALTER FUNCTION "public"."admin_console_storage"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."admin_console_storage"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_console_storage"() TO "service_role";
