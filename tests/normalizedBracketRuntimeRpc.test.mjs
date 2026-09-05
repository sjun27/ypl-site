import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rpcSql = readFileSync(
  new URL("../docs/db/normalized_bracket_runtime_rpc.sql", import.meta.url),
  "utf8"
);
const grantSql = readFileSync(
  new URL("../docs/db/normalized_bracket_runtime_grants.sql", import.meta.url),
  "utf8"
);

const createSignature = "create_normalized_single_bracket_runtime";
const deleteSignature = "delete_normalized_single_bracket_runtime";

test("RPC draft is schema-qualified, invoker-only, and does not read legacy graph", () => {
  assert.match(rpcSql, /create or replace function ypl_schema_validation\.create_normalized_single_bracket_runtime\(/i);
  assert.match(rpcSql, /create or replace function ypl_schema_validation\.delete_normalized_single_bracket_runtime\(/i);
  assert.match(rpcSql, /security invoker/i);
  assert.match(rpcSql, /set search_path = ''/i);
  assert.doesNotMatch(rpcSql, /ypl_data_v4/i);
  assert.doesNotMatch(rpcSql, /competition_settings/i);
  assert.doesNotMatch(rpcSql, /\bseed\b/i);
  assert.match(rpcSql, /participant_key is an input correlation key only/i);
});

test("create contract validates Event, identities, deterministic slots, BYE, and canonical Match", () => {
  const create = rpcSql.slice(rpcSql.indexOf(createSignature), rpcSql.indexOf("-- DELETE"));
  for (const pattern of [
    /p_runtime_id uuid/i,
    /p_event_id uuid/i,
    /p_participants jsonb/i,
    /p_slots jsonb/i,
    /from ypl_schema_validation\.events/i,
    /for update/i,
    /is_team_event/i,
    /competition_format <> 'single_elimination'/i,
    /record_applied_at/i,
    /status not in \('open', 'running'\)/i,
    /v_participant_count < 2/i,
    /count\(distinct player_id\)/i,
    /count\(distinct registration_id\)/i,
    /count\(distinct entry_id\)/i,
    /count\(distinct entry_participant_id\)/i,
    /while v_bracket_size < v_participant_count/i,
    /slot_no < 1 or s\.slot_no > v_bracket_size/i,
    /double-BYE/i,
    /bracket_runtimes as br[\s\S]*br\.event_id = p_event_id/i,
    /source_node_key/i,
    /single:r1:m/i,
    /match_kind, round_number, stage_label, sequence_no/i,
    /join slots a[\s\S]*join slots b/i,
    /set status = 'running'/i,
    /display_name Player가 이미 존재/i,
    /동일 이름의 Event Registration이 이미 존재/i,
  ]) assert.match(create, pattern);
  assert.ok(
    create.indexOf("insert into ypl_schema_validation.bracket_runtimes") <
      create.indexOf("insert into ypl_schema_validation.bracket_identity_changes"),
    "identity ownership rows must be inserted after their runtime parent"
  );
  assert.doesNotMatch(create, /Entry\.seed/i);
});

test("create retry is canonical-payload idempotent and fails closed on mismatch", () => {
  const create = rpcSql.slice(rpcSql.indexOf(createSignature), rpcSql.indexOf("-- DELETE"));
  assert.match(create, /where id = p_runtime_id/i);
  assert.match(create, /where br\.event_id = p_event_id/i);
  assert.match(create, /different|다른/i);
  assert.match(create, /동일 runtime_id의 payload가 기존 identity graph와 달라 retry를 거부/i);
  assert.match(create, /return query select p_runtime_id, p_event_id/i);
  assert.match(create, /false;/i);
  assert.match(create, /bracket_entry_slots[\s\S]*except/i);
  assert.match(create, /normalized_bracket_runtime[\s\S]*except/i);
});

test("create persists ownership and only immediately formed first-round Matches", () => {
  const create = rpcSql.slice(rpcSql.indexOf(createSignature), rpcSql.indexOf("-- DELETE"));
  for (const table of [
    "ypl_schema_validation.players",
    "ypl_schema_validation.event_registrations",
    "ypl_schema_validation.entries",
    "ypl_schema_validation.entry_participants",
    "ypl_schema_validation.bracket_identity_changes",
    "ypl_schema_validation.bracket_runtimes",
    "ypl_schema_validation.bracket_entry_slots",
    "ypl_schema_validation.matches",
  ]) assert.match(create, new RegExp(`insert into ${table.split(".").join("\\.")}`, "i"));
  assert.match(create, /insert into ypl_schema_validation\.matches[\s\S]*join slots a[\s\S]*join slots b/i);
  assert.match(create, /'unknown', 'normalized_bracket_runtime'/i);
  assert.match(create, /'single:r1:m' \|\| m\.match_no::text/i);
  assert.doesNotMatch(create, /insert into ypl_schema_validation\.matches[\s\S]*future/i);
});

test("delete contract is locked, fail-closed, submission-safe, and FK-order aware", () => {
  const del = rpcSql.slice(rpcSql.indexOf(deleteSignature), rpcSql.indexOf("-- SECURITY INVOKER"));
  for (const pattern of [
    /from ypl_schema_validation\.events[\s\S]*for update/i,
    /from ypl_schema_validation\.bracket_runtimes[\s\S]*for update/i,
    /record_applied_at/i,
    /results as r0 where r0\.event_id = p_event_id/i,
    /ranking_awards as a0 where a0\.event_id = p_event_id/i,
    /source <> 'normalized_bracket_runtime'/i,
    /registration_submissions/i,
    /final_submission_id/i,
    /v_identity_snapshot/i,
    /Snapshot ownership before deleting/i,
    /delete from ypl_schema_validation\.matches/i,
    /delete from ypl_schema_validation\.bracket_entry_slots/i,
    /delete from ypl_schema_validation\.bracket_identity_changes/i,
    /delete from ypl_schema_validation\.entry_participants/i,
    /delete from ypl_schema_validation\.entries/i,
    /registration_player_was_changed/i,
    /set player_id = v_change\.previous_registration_player_id/i,
    /delete from ypl_schema_validation\.players/i,
    /delete from ypl_schema_validation\.bracket_runtimes/i,
    /set status = v_runtime\.previous_event_status/i,
  ]) assert.match(del, pattern);
  assert.match(del, /exact ownership|exact-match/i);
  assert.match(del, /is distinct from/i);
  assert.match(del, /round_number is distinct from 1/i);
  assert.match(del, /raise exception/i);
});

test("function privileges revoke PUBLIC and grant EXECUTE only to anon", () => {
  assert.match(rpcSql, /revoke all on function ypl_schema_validation\.create_normalized_single_bracket_runtime\(uuid, uuid, jsonb, jsonb\) from public/i);
  assert.match(rpcSql, /grant execute on function ypl_schema_validation\.create_normalized_single_bracket_runtime\(uuid, uuid, jsonb, jsonb\) to anon/i);
  assert.match(rpcSql, /revoke all on function ypl_schema_validation\.delete_normalized_single_bracket_runtime\(uuid, uuid\) from public/i);
  assert.match(rpcSql, /grant execute on function ypl_schema_validation\.delete_normalized_single_bracket_runtime\(uuid, uuid\) to anon/i);
  assert.match(rpcSql, /from authenticated, service_role/i);
  assert.doesNotMatch(rpcSql, /grant execute[\s\S]*to authenticated/i);
  assert.doesNotMatch(rpcSql, /grant execute[\s\S]*to service_role/i);
});

test("Test table grant reproduction stays separate and forbids UPDATE", () => {
  assert.match(grantSql, /bracket_runtimes[\s\S]*to anon/i);
  assert.match(grantSql, /bracket_entry_slots[\s\S]*to anon/i);
  assert.match(grantSql, /bracket_identity_changes[\s\S]*to anon/i);
  assert.match(grantSql, /grant select, insert, delete/i);
  const statements = grantSql.replace(/^--.*$/gm, "");
  assert.doesNotMatch(statements, /update/i);
  assert.doesNotMatch(statements, /authenticated/i);
  assert.doesNotMatch(statements, /service_role/i);
  assert.doesNotMatch(statements, /enable row level security/i);
});
