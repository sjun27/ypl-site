-- YPL normalized bracket runtime Test privileges
-- Status: Test-only / DO NOT RUN ON PRODUCTION
--
-- This file intentionally remains separate from the runtime DDL. It mirrors
-- the P2-7B1.6 Test grant and gives only anon the immutable-fact table access
-- needed by the future Single runtime. UPDATE, authenticated, service_role,
-- RLS, and schema USAGE are deliberately not changed here.

grant select, insert, delete
on table ypl_schema_validation.bracket_runtimes
to anon;

grant select, insert, delete
on table ypl_schema_validation.bracket_entry_slots
to anon;

grant select, insert, delete
on table ypl_schema_validation.bracket_identity_changes
to anon;
