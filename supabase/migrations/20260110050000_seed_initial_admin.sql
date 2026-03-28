-- Create a table to list initial admin emails
CREATE TABLE IF NOT EXISTS public.initial_admins (
  email TEXT PRIMARY KEY
);

-- Seed a default admin email (change if you prefer a different address)
INSERT INTO public.initial_admins (email) VALUES ('admin@stoicops.com');

-- Replace the handle_new_user trigger to assign admin role when the
-- signing-up user's email exists in the initial_admins table.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  
  IF EXISTS (SELECT 1 FROM public.initial_admins WHERE email = NEW.email) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'client');
  END IF;
  
  RETURN NEW;
END;
$$;
