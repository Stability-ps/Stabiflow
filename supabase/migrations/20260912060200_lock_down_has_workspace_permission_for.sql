-- has_workspace_permission_for() accepts an arbitrary p_user_id - unlike
-- has_workspace_permission() (which only ever answers "does auth.uid()
-- have this permission", safe for anyone to call), this one would let ANY
-- authenticated caller ask "does user X have permission Y in workspace Z"
-- for a workspace they aren't even a member of - a real cross-tenant
-- information leak. Locked down the same way
-- get_workspace_integration_secret() already is (see multi-tenancy.md):
-- EXECUTE revoked from anon/authenticated, granted only to service_role -
-- the automations-actions/automations-tick edge functions are the only
-- realistic callers, and they always use the service-role client.
revoke execute on function public.has_workspace_permission_for(uuid, text, uuid) from public;
revoke execute on function public.has_workspace_permission_for(uuid, text, uuid) from authenticated;
revoke execute on function public.has_workspace_permission_for(uuid, text, uuid) from anon;
grant execute on function public.has_workspace_permission_for(uuid, text, uuid) to service_role;
