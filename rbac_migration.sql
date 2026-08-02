-- RBAC Migration Script
-- Run this in Supabase SQL Editor

-- 1. Create user_roles table
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'STAFF' CHECK (role IN ('ADMIN', 'STAFF')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create trigger to automatically add new auth users to user_roles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_roles (id, username, role, is_active)
  VALUES (
    NEW.id,
    SPLIT_PART(NEW.email, '@', 1), -- Extract username from username@estimateapp.local
    'STAFF',
    true
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists so we can recreate it
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Disable RLS for user_roles so the client can query and update it easily
-- Note: In a production app with public signups, RLS should be enabled.
-- Since this is an internal business app, we disable RLS for simplicity.
ALTER TABLE user_roles DISABLE ROW LEVEL SECURITY;

-- 4. Set existing users to ADMIN (since the owner is the only one who has logged in so far)
-- We manually insert the existing auth.users into user_roles if they don't exist
INSERT INTO user_roles (id, username, role, is_active)
SELECT id, SPLIT_PART(email, '@', 1), 'ADMIN', true
FROM auth.users
ON CONFLICT (id) DO UPDATE SET role = 'ADMIN';

-- 5. RPC function to allow ADMINs to reset user passwords
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.admin_reset_password(target_user_id UUID, new_password TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify caller is an ADMIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE id = auth.uid() AND role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can reset passwords';
  END IF;

  -- Update the password in auth.users
  UPDATE auth.users 
  SET encrypted_password = crypt(new_password, gen_salt('bf'))
  WHERE id = target_user_id;
END;
$$;
