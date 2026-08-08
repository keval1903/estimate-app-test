-- Add client_name to client_sites to support loose sites
ALTER TABLE client_sites ADD COLUMN IF NOT EXISTS client_name text;
