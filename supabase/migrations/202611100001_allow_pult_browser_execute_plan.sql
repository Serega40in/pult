ALTER TABLE public.qun_agent_commands
  DROP CONSTRAINT IF EXISTS qun_agent_commands_action_check;

ALTER TABLE public.qun_agent_commands
  ADD CONSTRAINT qun_agent_commands_action_check
  CHECK (action = ANY (ARRAY[
    'browser.list_tabs'::text,
    'browser.read_active_page'::text,
    'browser.open_url'::text,
    'browser.execute_plan'::text
  ]));
