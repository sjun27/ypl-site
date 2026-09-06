import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("docs/db/champions_application_event_pair_rpc.sql", "utf8");
const service = readFileSync("src/services/championsService.js", "utf8");
const page = readFileSync("src/pages/BracketsPage.jsx", "utf8");

test("Champions Final HOF removal RPC is narrow, guarded, and anon-only", () => {
  assert.match(sql, /create or replace function ypl_schema_validation\.remove_championship_final_hall_of_fame\(/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /event_type <> 'champions'/);
  assert.match(sql, /championship_phase <> 'final'/);
  assert.match(sql, /status <> 'completed'/);
  assert.match(sql, /record_applied_at is null/);
  assert.match(sql, /placement_code = 'champion'/);
  assert.match(sql, /delete from ypl_schema_validation\.hall_of_fame_entries/);
  assert.match(sql, /revoke all on function ypl_schema_validation\.remove_championship_final_hall_of_fame\(uuid\) from public/);
  assert.match(sql, /grant execute on function ypl_schema_validation\.remove_championship_final_hall_of_fame\(uuid\) to anon/);
});

test("normalized record revert removes HOF before Result and restores it after compensation", () => {
  const remove = page.indexOf("removeChampionshipHallOfFameEntry(b.eventId)");
  const awards = page.indexOf("deleteEventBracketRankingAwards(b.eventId,b)", remove);
  const results = page.indexOf("deleteEventBracketResults(b.eventId,b)", remove);
  const restoreResults = page.indexOf("restoreEventBracketResults(b.eventId,previousResultRows)", remove);
  const restoreAwards = page.indexOf("restoreEventBracketRankingAwards(b.eventId,previousAwardRows)", restoreResults);
  const restoreHof = page.indexOf("ensureChampionshipHallOfFameEntry(b.eventId,{hallOfFameId:previousHallOfFame.hallOfFameId})", restoreAwards);
  assert.ok(remove >= 0 && remove < awards && awards < results);
  assert.ok(restoreResults >= 0 && restoreResults < restoreAwards && restoreAwards < restoreHof);
});

test("HOF compensation can restore the exact previous identity", () => {
  assert.match(service, /ensureChampionshipHallOfFameEntry\(eventId, \{ hallOfFameId = null \} = \{\}\)/);
  assert.match(service, /const requestedHallOfFameId = hallOfFameId \|\| databaseUuid\(\)/);
  assert.match(service, /p_hall_of_fame_id: requestedHallOfFameId/);
  assert.match(service, /export async function removeChampionshipHallOfFameEntry\(eventId\)/);
});
