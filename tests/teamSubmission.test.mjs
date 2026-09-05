import assert from "node:assert/strict";
import test from "node:test";

import { builderRouteSearch, readInitialAppView } from "../src/services/appRouting.js";
import { buildTeamSnapshotSubmission, getSubmissionWriteGate } from "../src/services/teamSubmission.js";

const event = {
  id: "event-1",
  status: "open",
  record_applied_at: null,
  submission_target_at: "2026-09-05T00:00:00.000Z",
};
const registration = {
  id: "registration-1",
  event_id: "event-1",
  registration_name: "홍길동",
  registration_source: "application",
};

test("direct builder links preserve event context and App reads view=builder", () => {
  assert.equal(builderRouteSearch("event-1", "?foo=bar"), "?foo=bar&view=builder&eventId=event-1");
  assert.equal(readInitialAppView("?view=builder&eventId=event-1"), "builder");
  assert.equal(readInitialAppView("?view=not-a-page"), "home");
});

test("submission write gate allows late submissions but blocks completed and record-applied Events", () => {
  const late = getSubmissionWriteGate(event, { now: new Date("2026-09-05T01:00:00.000Z") });
  assert.equal(late.allowed, true);
  assert.equal(late.late, true);
  assert.match(late.warning, /지났지만/);
  assert.equal(getSubmissionWriteGate({ ...event, status: "completed" }).allowed, false);
  assert.equal(getSubmissionWriteGate({ ...event, status: "running", record_applied_at: "2026-09-05T00:00:00Z" }).allowed, false);
  assert.equal(getSubmissionWriteGate({ ...event, cup_rule_id: "unsupported-test-rule" }).allowed, false);
});

test("snapshot submission requires exact Event registration and eligibility, then creates immutable write payload", () => {
  const team = [{
    pokemon: { name: "Pikachu" },
    pokemonId: "pikachu",
    resolutionState: "resolved",
    originalPokemonName: "Pikachu",
    ability: "Static",
    alignment: "serious",
    statPoints: { hp: 4, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    item: "leftovers",
    moves: ["tackle", "", "", ""],
  }];
  const detailData = { pokedex: { pikachu: { id: "pikachu", num: 25, name: "Pikachu" } } };
  const payload = buildTeamSnapshotSubmission({
    event,
    registration,
    registrationName: " 홍길동 ",
    eligibility: { eligible: true },
    team,
    regulationId: "m-b",
    cupRuleId: "none",
    detailData,
    now: new Date("2026-09-05T01:02:03.000Z"),
  });
  assert.equal(payload.registrationName, "홍길동");
  assert.equal(payload.snapshot.schema_version, 1);
  assert.equal(payload.members[0].pokemon_id, "pikachu");
  assert.equal(payload.submittedAt, "2026-09-05T01:02:03.000Z");
  assert.throws(() => buildTeamSnapshotSubmission({
    event,
    registration: { ...registration, registration_name: "다른 이름" },
    registrationName: "홍길동",
    eligibility: { eligible: true },
    team,
    detailData,
  }), /exact match/);
  assert.throws(() => buildTeamSnapshotSubmission({ event, registration, registrationName: "홍길동", eligibility: { eligible: false }, team, detailData }), /eligibility/);
});
