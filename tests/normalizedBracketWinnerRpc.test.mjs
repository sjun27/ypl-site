import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../docs/db/normalized_bracket_winner_rpc.sql", import.meta.url),
  "utf8"
);

const functionName = "set_normalized_single_bracket_winner";

test("winner RPC is a schema-qualified SECURITY INVOKER draft", () => {
  assert.match(sql, /create or replace function ypl_schema_validation\.set_normalized_single_bracket_winner\(/i);
  assert.match(sql, /p_runtime_id uuid[\s\S]*p_event_id uuid[\s\S]*p_source_node_key text[\s\S]*p_winner_entry_id uuid/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /set search_path = ''/i);
  assert.doesNotMatch(sql, /ypl_data_v4/i);
  assert.doesNotMatch(sql, /competition_settings/i);
});

test("winner mutation locks Event, runtime, and Match state and applies gates", () => {
  for (const pattern of [
    /from ypl_schema_validation\.events[\s\S]*for update/i,
    /pg_advisory_xact_lock[\s\S]*from ypl_schema_validation\.bracket_runtimes/i,
    /from ypl_schema_validation\.matches as m[\s\S]*for update/i,
    /v_event\.is_team_event/i,
    /competition_format <> 'single_elimination'/i,
    /v_event\.status <> 'running'/i,
    /record_applied_at is not null/i,
    /topology_kind <> 'single_elimination'/i,
    /projection_version <> 1/i,
    /source <> 'normalized_bracket_runtime'/i,
    /from ypl_schema_validation\.results as r0 where r0\.event_id = p_event_id/i,
    /from ypl_schema_validation\.ranking_awards as a0 where a0\.event_id = p_event_id/i,
  ]) assert.match(sql, pattern);
});

test("persisted slots and Entry identity are the only topology inputs", () => {
  for (const pattern of [
    /from ypl_schema_validation\.bracket_identity_changes/i,
    /(?:from|join) ypl_schema_validation\.entry_participants/i,
    /from ypl_schema_validation\.bracket_entry_slots/i,
    /stage_kind <> 'elimination'/i,
    /stage_no <> 1/i,
    /pool_no <> 0/i,
    /slot_no < 1 or s\.slot_no > v_bracket_size/i,
    /double-BYE/i,
    /duplicate Entry identity/i,
    /member_order <> 1/i,
    /no Entry-id ordering|Entry\.seed ordering|implicit fallback/i,
  ]) assert.match(sql, pattern);
  assert.doesNotMatch(sql, /order by .*entry.*id/i);
});

test("target node and winner validation fail closed for BYE/future/foreign winners", () => {
  for (const pattern of [
    /!~ '\^single:r\[1-9\]\[0-9\]\*:m\[1-9\]\[0-9\]\*\$'/i,
    /v_target_round > v_max_round/i,
    /v_target_match_no > v_round_match_count/i,
    /normalized Match에 생성할 수 없는 Single node key/i,
    /normalized Match field가 Single canonical contract/i,
    /stage_label is distinct from/i,
    /sequence_no is distinct from/i,
    /BYE\/future node는 변경할 수 없습니다/i,
    /entry_a_id is null or v_target_match\.entry_b_id is null/i,
    /p_winner_entry_id not in \(v_target_match\.entry_a_id, v_target_match\.entry_b_id\)/i,
  ]) assert.match(sql, pattern);
});

test("winner select/cancel/change uses one target update and clears only descendants", () => {
  for (const pattern of [
    /p_winner_entry_id uuid/i,
    /v_target_match\.winner_entry_id is not distinct from p_winner_entry_id/i,
    /return query select p_runtime_id, p_event_id, p_source_node_key/i,
    /deepest first/i,
    /target node's descendant chain/i,
    /reverse v_max_round/i,
    /delete from ypl_schema_validation\.matches/i,
    /set winner_entry_id = p_winner_entry_id/i,
    /resolution = case when p_winner_entry_id is null then 'unknown' else 'played' end/i,
    /played_at = case when p_winner_entry_id is null then null else now\(\) end/i,
    /winner_entry_id = null, formed = false/i,
  ]) assert.match(sql, pattern);
  assert.match(sql, /sibling[\s\S]*subtrees and the target Match itself remain intact/i);
});

test("formed downstream Matches are recreated with canonical fields and NULL winner", () => {
  for (const pattern of [
    /if not v_formed then/i,
    /insert into ypl_schema_validation\.matches/i,
    /match_kind, parent_match_id, round_number, stage_label/i,
    /entry_a_id, entry_b_id, player_a_id, player_b_id/i,
    /winner_entry_id, winner_player_id, resolution, source/i,
    /'bracket'/i,
    /'unknown'/i,
    /'normalized_bracket_runtime'/i,
    /source_node_key, played_at/i,
    /returning id into v_match_id/i,
  ]) assert.match(sql, pattern);
  assert.match(sql, /winner_entry_id = null/);
  assert.match(sql, /parent_match_id, round_number/);
  assert.doesNotMatch(sql, /parent_match_id = v_target_match\.id/i);
});

test("winner mutation repairs a missing already-formed sibling from older create revisions", () => {
  assert.match(sql, /Older create revisions persisted only first-round real/i);
  assert.match(sql, /elsif v_formed[\s\S]*insert into ypl_schema_validation\.matches/i);
  assert.match(sql, /v_match_found := true/i);
  assert.doesNotMatch(sql, /message = 'formed downstream Match가 누락되었습니다.'/i);
});

test("return contract reports previous/new winner and cascade counts", () => {
  for (const field of [
    "runtime_id uuid",
    "event_id uuid",
    "source_node_key text",
    "previous_winner_entry_id uuid",
    "winner_entry_id uuid",
    "deleted_downstream_count integer",
    "created_downstream_count integer",
    "changed boolean",
  ]) assert.match(sql, new RegExp(field, "i"));
  assert.match(sql, /v_deleted_downstream, v_created_downstream, not v_repair_only/i);
  assert.match(sql, /0, 0, false/i);
});

test("winner RPC ACL is anon-only with PUBLIC revoked", () => {
  assert.match(sql, new RegExp(`revoke all on function ypl_schema_validation\\.${functionName}\\(uuid, uuid, text, uuid\\) from public`, "i"));
  assert.match(sql, new RegExp(`grant execute on function ypl_schema_validation\\.${functionName}\\(uuid, uuid, text, uuid\\) to anon`, "i"));
  assert.match(sql, /from authenticated, service_role/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to authenticated/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to service_role/i);
});
