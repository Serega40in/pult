ALTER TABLE public.qun_agent_devices
  ADD COLUMN IF NOT EXISTS token_hash text,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS uq_qun_agent_devices_token_hash
  ON public.qun_agent_devices (token_hash)
  WHERE token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.qun_agent_pairing_codes (
  code_hash text PRIMARY KEY CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.qun_agent_pairing_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qun_agent_pairing_codes FROM anon, authenticated;
