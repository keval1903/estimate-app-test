-- Add alias column to user_roles for the "Prepared By" default
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS alias TEXT;
