
-- Validation trigger: reject non-numeric phone_number on contacts
CREATE OR REPLACE FUNCTION public.validate_contact_phone_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Strip all non-digit characters for validation
  IF NEW.phone_number IS NOT NULL THEN
    -- Block values with LID- prefix
    IF NEW.phone_number LIKE 'LID-%' THEN
      RAISE EXCEPTION 'phone_number cannot contain LID- prefix: %', NEW.phone_number;
    END IF;
    -- Block values with any non-digit characters
    IF NEW.phone_number ~ '[^0-9]' THEN
      RAISE EXCEPTION 'phone_number must contain only digits: %', NEW.phone_number;
    END IF;
    -- Block values that are too short to be a valid international number (min 10 digits)
    IF length(NEW.phone_number) < 10 THEN
      RAISE EXCEPTION 'phone_number too short (min 10 digits): %', NEW.phone_number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Attach trigger to contacts table
DROP TRIGGER IF EXISTS trg_validate_contact_phone ON public.contacts;
CREATE TRIGGER trg_validate_contact_phone
  BEFORE INSERT OR UPDATE OF phone_number ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_contact_phone_number();
