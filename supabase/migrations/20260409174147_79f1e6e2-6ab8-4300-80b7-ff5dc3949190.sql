
-- Tabela de emails convidados
CREATE TABLE public.invited_emails (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT invited_emails_email_unique UNIQUE (email)
);

-- Enable RLS
ALTER TABLE public.invited_emails ENABLE ROW LEVEL SECURITY;

-- Only admins can manage invited emails
CREATE POLICY "Admins can manage invited_emails"
ON public.invited_emails
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Public function to check if email is invited (callable before auth)
CREATE OR REPLACE FUNCTION public.is_email_invited(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.invited_emails
    WHERE LOWER(email) = LOWER(p_email)
      AND used_at IS NULL
  );
$$;

-- Function to mark invite as used (called after successful signup)
CREATE OR REPLACE FUNCTION public.mark_invite_used()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.invited_emails
  SET used_at = now(), updated_at = now()
  WHERE LOWER(email) = LOWER(NEW.email);
  RETURN NEW;
END;
$$;

-- Trigger on auth.users to mark invite as used on signup
CREATE TRIGGER on_auth_user_created_mark_invite
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.mark_invite_used();
