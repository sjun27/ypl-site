import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHallOfFameArtworkLookup,
  generationNumberFromLegacyLabel,
  isNormalizedChampionsHallOfFame,
  legacyChampionLabel,
  normalizedChampionLabel,
  normalizedSeasonLabel,
  resolveHallOfFameArtwork,
} from "../src/services/hallOfFamePresentation.js";

test("legacy labels keep their stored wording without duplicating 챔피언", () => {
  assert.equal(legacyChampionLabel("초대"), "초대 챔피언");
  assert.equal(legacyChampionLabel("6대 챔피언"), "6대 챔피언");
  assert.equal(generationNumberFromLegacyLabel("6대 챔피언"), 6);
});

test("normalized labels use Event battle format and Season relation", () => {
  assert.equal(isNormalizedChampionsHallOfFame({ event_type: "champions", championship_phase: "final" }), true);
  assert.equal(isNormalizedChampionsHallOfFame({ event_type: "champions", championship_phase: null }), false);
  assert.equal(normalizedChampionLabel(7, "singles"), "7대 싱글 챔피언");
  assert.equal(normalizedChampionLabel(7, "doubles"), "7대 더블 챔피언");
  assert.equal(normalizedSeasonLabel({ series: "ypl", number: 3 }), "YPL SEASON 3");
});

test("artwork lookup resolves canonical ids and legacy Korean names without persistence", () => {
  const lookup = buildHallOfFameArtworkLookup(new Map([
    ["gardevoir", { pokemonId: "gardevoir", dexNumber: 282, canonicalName: "Gardevoir", displayName: "가디안" }],
    ["garchomp", { pokemonId: "garchomp", dexNumber: 445, canonicalName: "Garchomp", displayName: "한카리아스" }],
  ]));
  assert.match(resolveHallOfFameArtwork({ pokemonId: "gardevoir" }, lookup), /official-artwork\/282\.png$/);
  assert.match(resolveHallOfFameArtwork({ name: "한카리아스" }, lookup), /official-artwork\/445\.png$/);
});
