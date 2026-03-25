UPDATE contacts 
SET call_name = 'Camila',
    updated_at = now()
WHERE name LIKE '%Camila%' AND (call_name IS NULL OR call_name LIKE '%⚜%' OR call_name LIKE '%Dra%');