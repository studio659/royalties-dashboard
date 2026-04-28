-- ============================================================
-- SCHEMA ROYALTIES DASHBOARD
-- À coller dans l'éditeur SQL de Supabase
-- ============================================================

-- Table principale
CREATE TABLE IF NOT EXISTS royalties (
  id        BIGSERIAL PRIMARY KEY,
  month     CHAR(7)       NOT NULL,  -- Format: 2026-03
  artist    VARCHAR(150)  NOT NULL,
  title     VARCHAR(300)  NOT NULL,
  store     VARCHAR(150)  NOT NULL,
  usd       DECIMAL(12,4) NOT NULL,
  created_at TIMESTAMPTZ  DEFAULT NOW()
);

-- Index pour les performances
CREATE INDEX IF NOT EXISTS idx_royalties_month  ON royalties(month);
CREATE INDEX IF NOT EXISTS idx_royalties_artist ON royalties(artist);

-- Table de settings (taux EUR, etc.)
CREATE TABLE IF NOT EXISTS settings (
  key        VARCHAR(50)  PRIMARY KEY,
  value      TEXT         NOT NULL,
  updated_at TIMESTAMPTZ  DEFAULT NOW()
);
INSERT INTO settings (key, value) VALUES ('eur_rate', '0.92')
  ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- SÉCURITÉ : Row Level Security
-- ============================================================

-- Royalties : lecture pour tout le monde authentifié
ALTER TABLE royalties ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON royalties;
CREATE POLICY "authenticated_all" ON royalties
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Settings : lecture/écriture pour tout le monde authentifié
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON settings;
CREATE POLICY "authenticated_all" ON settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- DONE ! Tu peux maintenant ajouter des utilisateurs via
-- Authentication > Users > Invite user dans Supabase.
-- ============================================================
