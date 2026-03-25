UPDATE contacts 
SET phone_number = '138731889627306', 
    whatsapp_id = '138731889627306@lid',
    name = COALESCE(name, 'Catarina'),
    updated_at = now()
WHERE id = '3f4144d8-9245-4c78-b916-a48d76f0c6b5';