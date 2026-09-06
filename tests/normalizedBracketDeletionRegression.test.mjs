import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/BracketsPage.jsx", "utf8");
const app = readFileSync("src/App.jsx", "utf8");
const singleSql = readFileSync("docs/db/normalized_bracket_runtime_rpc.sql", "utf8");
const genericSql = readFileSync("docs/db/normalized_bracket_runtime_elimination_rpc.sql", "utf8");

test("normalized deletion routes by competition topology, not Pokémon battle format", () => {
  assert.match(page, /b\.mode==="single"&&b\.projection\?\.topology==="single_elimination"/);
  assert.match(page, /\? deleteNormalizedSingleBracketRuntime\s*: deleteNormalizedBracketRuntime/);
});

test("individual single-elimination deletion preserves existing Registration submissions", () => {
  const guard = singleSql.slice(
    singleSql.indexOf("대진 생성 과정에서 만든 Registration에 Submission/history"),
    singleSql.indexOf("대진 생성 과정에서 만든 Registration에 Submission/history") + 1200
  );
  assert.match(singleSql, /where c\.registration_was_created/);
  assert.match(singleSql, /registration_submissions/);
  assert.ok(!guard.includes("Submission/history가 연결된 Registration은 자동 삭제할 수 없습니다."));
});

test("generic deletion allows unapplied completed Champions qualifier and cancels only qualifier-derived advancements", () => {
  assert.match(genericSql, /v_event\.status = 'completed'/);
  assert.match(genericSql, /v_event\.event_type = 'champions'/);
  assert.match(genericSql, /v_event\.championship_phase = 'qualifier'/);
  assert.match(genericSql, /v_event\.record_applied_at is not null/);
  assert.match(genericSql, /perform ypl_schema_validation\.cancel_championship_advancement\(ca\.id\)/);
  assert.match(genericSql, /join ypl_schema_validation\.entries source_entry\s+on source_entry\.id = ca\.source_entry_id/);
  assert.match(genericSql, /where source_entry\.event_id = p_event_id/);
  assert.ok(!genericSql.includes("본선 진출 확정 기록이 남아 있어 선발전 대진표를 삭제할 수 없습니다."));
});

test("generic deletion snapshots identity and rolls it back in FK-safe order", () => {
  const start = genericSql.indexOf("select coalesce(jsonb_agg(jsonb_build_object(");
  assert.ok(start >= 0, "identity snapshot block must exist");
  const body = genericSql.slice(start);
  const matches = body.indexOf("delete from ypl_schema_validation.matches");
  const slots = body.indexOf("delete from ypl_schema_validation.bracket_entry_slots");
  const identity = body.indexOf("delete from ypl_schema_validation.bracket_identity_changes");
  const participants = body.indexOf("delete from ypl_schema_validation.entry_participants");
  const entries = body.indexOf("delete from ypl_schema_validation.entries");
  const registrationsRestore = body.indexOf("update ypl_schema_validation.event_registrations");
  const registrationsDelete = body.indexOf("delete from ypl_schema_validation.event_registrations");
  const players = body.indexOf("delete from ypl_schema_validation.players");
  const runtime = body.indexOf("delete from ypl_schema_validation.bracket_runtimes");

  assert.ok(matches >= 0 && matches < slots);
  assert.ok(slots < identity && identity < participants);
  assert.ok(participants < entries && entries < registrationsRestore);
  assert.ok(registrationsRestore < registrationsDelete);
  assert.ok(registrationsDelete < players && players < runtime);

  assert.match(body, /jsonb_to_recordset\(v_identity_snapshot\)/);
  assert.match(body, /previous_registration_player_id/);
  assert.match(body, /not exists \(\s*select 1 from ypl_schema_validation\.event_registrations/);
  assert.match(body, /not exists \(\s*select 1 from ypl_schema_validation\.entry_participants/);
});

test("generic runtime creation failure does not double-rollback participant identity", () => {
  assert.match(page, /if\(confirmation&&!cleanupError&&!createdRuntime\)/);
  assert.ok(!page.includes("if(confirmation&&!cleanupError){"));
});

test("normalized brackets never persist or reappear through legacy site_data", () => {
  assert.match(app, /brackets:Array\.isArray\(next\?\.brackets\)\?next\.brackets\.filter\(b=>b\?\.projection\?\.source!=="normalized"\)/);
  assert.match(page, /\(data\.brackets\|\|\[\]\)\.filter\(b=>b\?\.projection\?\.source!=="normalized"/);
});
