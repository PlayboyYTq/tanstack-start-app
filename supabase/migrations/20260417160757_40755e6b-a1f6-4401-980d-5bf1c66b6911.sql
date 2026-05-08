-- Add phone column to profiles, unique
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text UNIQUE;

-- Update handle_new_user trigger function to also store phone
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, name, date_of_birth, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(coalesce(new.email,''),'@',1), 'User'),
    nullif(new.raw_user_meta_data->>'date_of_birth','')::date,
    coalesce(new.phone, new.raw_user_meta_data->>'phone')
  )
  on conflict (id) do update set
    phone = coalesce(excluded.phone, public.profiles.phone);
  return new;
end;
$function$;

-- Make sure trigger exists on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Also sync phone on auth.users updates (e.g. when phone is verified later)
CREATE OR REPLACE FUNCTION public.sync_user_phone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.phone is distinct from old.phone then
    update public.profiles set phone = new.phone where id = new.id;
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_phone_updated ON auth.users;
CREATE TRIGGER on_auth_user_phone_updated
  AFTER UPDATE OF phone ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_user_phone();
