import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../docs/db/champions_application_event_pair_rpc.sql", import.meta.url),
  "utf8"
);

test("Champions notice RPC atomically owns a fixed Qualifier/Final pair", () => {
  for (const pattern of [
    /save_championship_application_event_pair/i,
    /security invoker/i,
    /set search_path = ''/i,
    /'champions', null, p_battle_format, 'double_elimination'/i,
    /'champions', null, p_battle_format, 'single_elimination'/i,
    /'qualifier', p_final_event_id, p_qualification_slots/i,
    /'final', null, null/i,
    /'generation', p_generation/i,
    /'finalCapacity', p_final_capacity/i,
    /Event pair가 부분 생성 상태/i,
  ]) assert.match(sql, pattern);
  assert.doesNotMatch(sql, /'champions', 'master'/i);
});

test("Champions pair editing preserves IDs and fails closed after downstream facts", () => {
  assert.match(sql, /v_critical_changed and/i);
  for (const table of [
    "event_registrations",
    "entries",
    "matches",
    "bracket_runtimes",
    "championship_advancements",
  ]) assert.match(sql, new RegExp(`ypl_schema_validation\\.${table}`, "i"));
  assert.match(sql, /where e\.id = p_final_event_id/i);
  assert.match(sql, /where e\.id = p_qualifier_event_id/i);
});

test("Champions pair cancellation only marks unused owned Events cancelled", () => {
  assert.match(sql, /cancel_championship_application_event_pair/i);
  assert.match(sql, /downstream 사실이 있어 공지 삭제 시 Event를 보존/i);
  assert.match(sql, /set status = 'cancelled'/i);
  assert.doesNotMatch(sql, /delete from ypl_schema_validation\.events/i);
});

test("Champions pair RPC privileges are anon-only", () => {
  assert.match(sql, /revoke all on function[\s\S]*from public/i);
  assert.match(sql, /from authenticated, service_role/i);
  assert.match(sql, /grant execute on function[\s\S]*to anon/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]*to authenticated/i);
  assert.match(sql, /create_championship_advancement[\s\S]*security definer/i);
  assert.match(sql, /cancel_championship_advancement[\s\S]*security definer/i);
  assert.match(sql, /ensure_championship_final_hall_of_fame[\s\S]*security definer/i);
  assert.match(sql, /grant select on table ypl_schema_validation\.championship_advancements to anon/i);
  assert.match(sql, /grant select on table ypl_schema_validation\.hall_of_fame_entries to anon/i);
  assert.doesNotMatch(sql, /grant (?:insert|delete)[\s\S]*on table ypl_schema_validation\.championship_advancements/i);
});
