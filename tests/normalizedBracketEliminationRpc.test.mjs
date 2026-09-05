import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sql = await readFile(
  fileURLToPath(new URL("../docs/db/normalized_bracket_runtime_elimination_rpc.sql", import.meta.url)),
  "utf8"
);

test("Team/Double runtime RPC is additive, invoker-only, and topology-discriminated", () => {
  assert.match(sql, /topology_kind in \('single_elimination', 'double_elimination'\)/i);
  assert.match(sql, /create or replace function ypl_schema_validation\.create_normalized_bracket_runtime\(/i);
  assert.match(sql, /p_topology_kind text[\s\S]*p_participants jsonb[\s\S]*p_slots jsonb/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /v_event\.competition_format <> p_topology_kind/i);
  assert.match(sql, /v_event\.is_team_event then 'team' else 'individual'/i);
  assert.match(sql, /개인전 Single은 기존 Single runtime RPC를 사용해야 합니다/);
  assert.match(sql, /bracket_identity_changes/i);
  assert.match(sql, /bracket_entry_slots/i);
  assert.doesNotMatch(sql, /legacy_bracket_runtime/i);
  assert.doesNotMatch(sql, /grant (all|select,?\s*insert,?\s*update|.*delete on table)/i);
});

test("runtime delete is exact, fail-closed, and removes only runtime artifacts", () => {
  assert.match(sql, /create or replace function ypl_schema_validation\.delete_normalized_bracket_runtime\(/i);
  assert.match(sql, /from ypl_schema_validation\.events[\s\S]*where id = p_event_id[\s\S]*for update/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /v_event\.status not in \('open', 'running'\)/i);
  assert.match(sql, /v_event\.record_applied_at is not null/i);
  assert.match(sql, /source <> 'normalized_bracket_runtime'/i);
  assert.match(sql, /runtime identity ownership exact-match/i);
  assert.match(sql, /normalized Match shape\/source ownership/i);
  assert.match(sql, /source_node_key가 중복/i);
  assert.match(sql, /Only runtime artifacts are removed/i);
  assert.doesNotMatch(sql, /delete from ypl_schema_validation\.(players|event_registrations|entries|entry_participants)/i);
  assert.match(sql, /revoke all on function ypl_schema_validation\.delete_normalized_bracket_runtime\(uuid,\s*uuid\) from public/i);
});
