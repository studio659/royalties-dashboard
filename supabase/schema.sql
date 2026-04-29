-- ============================================================
-- SCHEMA ROYALTIES DASHBOARD — Version complète
-- À coller dans Supabase → SQL Editor → Run
-- ============================================================

-- ── Table principale des royalties ──────────────────────────
CREATE TABLE IF NOT EXISTS royalties (
  id           BIGSERIAL PRIMARY KEY,
  month        CHAR(7)        NOT NULL,          -- Format: 2026-03
  artist       VARCHAR(150)   NOT NULL,
  title        VARCHAR(300)   NOT NULL,
  store        VARCHAR(150)   NOT NULL,
  country      VARCHAR(100)   DEFAULT '',
  isrc         VARCHAR(20)    DEFAULT '',
  qty          INTEGER        DEFAULT 0,
  usd          DECIMAL(12,4)  DEFAULT 0,         -- legacy (ne plus utiliser)
  amount       NUMERIC,                           -- montant natif (€ ou $)
  currency     TEXT           DEFAULT 'USD',      -- 'EUR' ou 'USD'
  statement_id TEXT           DEFAULT '',         -- nom du fichier importé
  created_at   TIMESTAMPTZ    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_royalties_month       ON royalties(month);
CREATE INDEX IF NOT EXISTS idx_royalties_artist      ON royalties(artist);
CREATE INDEX IF NOT EXISTS idx_royalties_artist_month ON royalties(artist, month);
CREATE INDEX IF NOT EXISTS idx_royalties_currency    ON royalties(currency);
CREATE INDEX IF NOT EXISTS idx_royalties_statement   ON royalties(statement_id);

-- ── Vue agrégée (dashboard) ─────────────────────────────────
CREATE OR REPLACE VIEW royalties_monthly AS
SELECT
  artist, month,
  SUM(CASE WHEN currency = 'EUR' THEN COALESCE(amount, 0) ELSE 0 END) AS amount_eur,
  SUM(CASE WHEN currency = 'USD' THEN COALESCE(amount, 0) ELSE 0 END) AS amount_usd,
  SUM(qty) AS qty,
  CASE
    WHEN SUM(CASE WHEN currency = 'EUR' THEN ABS(COALESCE(amount, 0)) ELSE 0 END)
       >= SUM(CASE WHEN currency = 'USD' THEN ABS(COALESCE(amount, 0)) ELSE 0 END)
    THEN 'EUR' ELSE 'USD'
  END AS currency
FROM royalties
GROUP BY artist, month;

GRANT SELECT ON royalties_monthly TO anon, authenticated;

-- ── Artistes (dynamique) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS artists (
  id         BIGSERIAL PRIMARY KEY,
  name       VARCHAR(150)  NOT NULL UNIQUE,
  color      VARCHAR(20)   DEFAULT '#888',
  sources    JSONB         DEFAULT '["distrokid"]',
  created_at TIMESTAMPTZ   DEFAULT NOW()
);

-- ── Settings (taux EUR, etc.) ───────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key        VARCHAR(50)  PRIMARY KEY,
  value      TEXT         NOT NULL,
  updated_at TIMESTAMPTZ  DEFAULT NOW()
);
INSERT INTO settings (key, value) VALUES ('eur_rate', '0.92')
  ON CONFLICT (key) DO NOTHING;

-- ── Logs d'import ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS import_logs (
  id             BIGSERIAL PRIMARY KEY,
  artist         VARCHAR(150),
  source         VARCHAR(50),
  filename       TEXT,
  rows_imported  INTEGER,
  months_covered TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Recoupe : séries de singles ─────────────────────────────
CREATE TABLE IF NOT EXISTS series (
  id           BIGSERIAL PRIMARY KEY,
  artist       VARCHAR(150) NOT NULL,
  name         VARCHAR(200) NOT NULL,
  artist_rate  NUMERIC DEFAULT 12,
  mgmt_rate    NUMERIC DEFAULT 5,
  label_rate   NUMERIC DEFAULT 60,
  coprod_rate  NUMERIC DEFAULT 40,
  coprod_name  VARCHAR(150),
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Recoupe : singles ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS singles (
  id           BIGSERIAL PRIMARY KEY,
  series_id    BIGINT REFERENCES series(id) ON DELETE CASCADE,
  artist       VARCHAR(150) NOT NULL,
  title        VARCHAR(300) NOT NULL,
  release_date DATE,
  budget_eur   NUMERIC DEFAULT 0,
  artist_rate  NUMERIC,
  mgmt_rate    NUMERIC,
  label_rate   NUMERIC,
  coprod_rate  NUMERIC,
  coprod_name  VARCHAR(150),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── Recoupe : lignes de budget ───────────────────────────────
CREATE TABLE IF NOT EXISTS budget_lines (
  id         BIGSERIAL PRIMARY KEY,
  single_id  BIGINT REFERENCES singles(id) ON DELETE CASCADE,
  label      VARCHAR(200) NOT NULL,
  amount_eur NUMERIC DEFAULT 0,
  status     VARCHAR(20) DEFAULT 'pending', -- 'pending' | 'paid'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- SÉCURITÉ : Row Level Security
-- ============================================================

ALTER TABLE royalties   ENABLE ROW LEVEL SECURITY;
ALTER TABLE artists     ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE series      ENABLE ROW LEVEL SECURITY;
ALTER TABLE singles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_lines ENABLE ROW LEVEL SECURITY;

-- Politique : accès complet pour les utilisateurs authentifiés
DO $$ DECLARE t TEXT;
BEGIN FOR t IN SELECT unnest(ARRAY['royalties','artists','settings','import_logs','series','singles','budget_lines'])
LOOP EXECUTE format('DROP POLICY IF EXISTS "authenticated_all" ON %I', t);
     EXECUTE format('CREATE POLICY "authenticated_all" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
END LOOP; END $$;

-- ============================================================
-- DONE — Créer des utilisateurs via Authentication > Users > Invite user
-- ============================================================
