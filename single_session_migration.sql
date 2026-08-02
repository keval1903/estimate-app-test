-- Add current_session_token to user_roles
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS current_session_token TEXT;
