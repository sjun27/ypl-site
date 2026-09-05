import assert from "node:assert/strict";
import test from "node:test";

import {
  advancementCancellationError,
  buildChampionshipSettings,
  buildFinalRegistrationPayload,
  championshipFinalCapacity,
  championshipGeneration,
  isChampionshipFinal,
  isChampionshipQualifier,
  qualifierCompletionState,
  validateAdvancementInput,
} from "../src/services/championsCore.js";

const qualifier = {
  id: "qualifier",
  event_type: "champions",
  championship_phase: "qualifier",
  championship_final_event_id: "final",
  qualification_slots: 2,
  status: "running",
};
const final = {
  id: "final",
  event_type: "champions",
  championship_phase: "final",
  status: "open",
  competition_settings: { championship: { generationNumber: 7, finalCapacity: 4 } },
};

test("Champions phase and settings are read from existing Event fields", () => {
  assert.equal(isChampionshipQualifier(qualifier), true);
  assert.equal(isChampionshipFinal(final), true);
  assert.equal(championshipGeneration(final), 7);
  assert.equal(championshipFinalCapacity(final), 4);
  assert.equal(championshipGeneration({ competition_settings: { championship: { generation: 9 } } }), 9);
  assert.equal(championshipGeneration({ competition_settings: { championship: { generationNumber: 8 } } }), 8);
  assert.equal(championshipGeneration({}), null);
  assert.deepEqual(buildChampionshipSettings(final, { generationNumber: 8, finalCapacity: 8 }), {
    championship: { generation: 8, finalCapacity: 8 },
  });
});

test("advancement validation keeps source manual and never auto-selects players", () => {
  assert.deepEqual(validateAdvancementInput({
    finalEvent: final,
    existingAdvancements: [],
    playerId: "player-a",
    advancementType: "ranking",
  }), []);
  assert.match(validateAdvancementInput({
    finalEvent: final,
    existingAdvancements: [{ player_id: "player-a" }],
    playerId: "player-a",
    advancementType: "ranking",
  }).join(" "), /이미 본선/);
  assert.match(validateAdvancementInput({
    finalEvent: final,
    qualifierEvent: qualifier,
    existingAdvancements: [],
    playerId: "player-a",
    advancementType: "qualifier",
    sourceEntry: { id: "entry-a", event_id: "qualifier", player_id: "player-b" },
  }).join(" "), /다릅니다/);
});

test("final registration is a new advancement registration and contains no Entry", () => {
  const payload = buildFinalRegistrationPayload({ finalEvent: final, player: { id: "player-a", display_name: "A" }, reason: "replacement" });
  assert.equal(payload.event_id, "final");
  assert.equal(payload.player_id, "player-a");
  assert.equal(payload.registration_source, "advancement");
  assert.equal(payload.registration_data.champions.generation, 7);
  assert.equal("entry_id" in payload, false);
});

test("qualifier closes only after the configured number of manual advances", () => {
  assert.equal(qualifierCompletionState({ qualifierEvent: qualifier, qualifiedCount: 1 }).ok, false);
  assert.equal(qualifierCompletionState({ qualifierEvent: qualifier, qualifiedCount: 2 }).ok, true);
  assert.equal(qualifierCompletionState({ qualifierEvent: { ...qualifier, status: "completed" }, qualifiedCount: 2 }).alreadyCompleted, true);
});

test("advancement cancellation fails closed once downstream facts exist", () => {
  assert.equal(advancementCancellationError({}), null);
  assert.match(advancementCancellationError({ submissions: 1 }), /후속 사실/);
  assert.match(advancementCancellationError({ matches: 1 }), /후속 사실/);
});
