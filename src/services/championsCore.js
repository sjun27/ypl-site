export const CHAMPIONS_ADVANCEMENT_TYPES = ["ranking", "qualifier", "manual"];

export function championshipSettings(event = {}) {
  const settings = event?.competition_settings?.championship;
  return settings && typeof settings === "object" ? settings : {};
}

export const CHAMPIONSHIP_QUALIFIER_FORMAT = "double_elimination";
export const CHAMPIONSHIP_FINAL_FORMAT = "single_elimination";

export function championshipPhaseLabel(event = {}) {
  if (event?.event_type !== "champions") return "";
  if (event?.championship_phase === "qualifier") return "선발전";
  if (event?.championship_phase === "final") return "본선";
  return "";
}

export function championshipEventPickerLabel(event = {}) {
  const phase = championshipPhaseLabel(event);
  return phase ? `[${phase}] ${event.name || "Champions"}` : event.name || "Champions";
}

export function normalizeChampionshipApplicationDraft(eventDraft = {}) {
  const name = String(eventDraft.name || "").trim();
  const battleFormat = String(eventDraft.battleFormat || "").trim();
  const generation = Number(eventDraft.generation);
  const finalCapacity = Number(eventDraft.finalCapacity);
  const qualificationSlots = Number(eventDraft.qualificationSlots);
  if (!name) throw new Error("Champions 대회 이름을 입력해 주세요.");
  if (!["singles", "doubles"].includes(battleFormat)) throw new Error("Champions 배틀 형식은 싱글 또는 더블이어야 합니다.");
  if (!Number.isInteger(generation) || generation < 1) throw new Error("Champions generation을 입력해 주세요.");
  if (!Number.isInteger(finalCapacity) || finalCapacity < 2) throw new Error("본선 정원은 2명 이상이어야 합니다.");
  if (!Number.isInteger(qualificationSlots) || qualificationSlots < 1 || qualificationSlots > finalCapacity) {
    throw new Error("선발 인원은 1명 이상, 본선 정원 이하여야 합니다.");
  }
  return {
    ...eventDraft,
    name,
    eventType: "champions",
    division: null,
    isTeamEvent: false,
    battleFormat,
    competitionFormat: null,
    generation,
    finalCapacity,
    qualificationSlots,
  };
}

export function championshipGeneration(event = {}, fallback = null) {
  const settings = championshipSettings(event);
  const value = Number(settings.generation ?? settings.generationNumber);
  if (Number.isInteger(value) && value > 0) return value;
  const fallbackValue = Number(fallback);
  return Number.isInteger(fallbackValue) && fallbackValue > 0 ? fallbackValue : null;
}

export function championshipFinalCapacity(event = {}) {
  const value = Number(championshipSettings(event).finalCapacity);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function isChampionshipQualifier(event = {}) {
  return event?.event_type === "champions" && event?.championship_phase === "qualifier";
}

export function isChampionshipFinal(event = {}) {
  return event?.event_type === "champions" && event?.championship_phase === "final";
}

export function buildChampionshipSettings(event = {}, { generationNumber, finalCapacity } = {}) {
  const current = championshipSettings(event);
  const next = { ...current };
  if (generationNumber !== undefined) {
    next.generation = Number(generationNumber);
    delete next.generationNumber;
  }
  if (finalCapacity !== undefined) next.finalCapacity = Number(finalCapacity);
  return {
    ...(event?.competition_settings || {}),
    championship: next,
  };
}

export function validateAdvancementInput({
  finalEvent,
  qualifierEvent = null,
  existingAdvancements = [],
  playerId,
  advancementType,
  sourceEntry = null,
  finalCapacity = null,
} = {}) {
  const errors = [];
  if (!isChampionshipFinal(finalEvent)) errors.push("본선 Event만 advancement 대상이 될 수 있습니다.");
  if (!playerId) errors.push("Player를 선택해 주세요.");
  if (!CHAMPIONS_ADVANCEMENT_TYPES.includes(advancementType)) errors.push("지원되지 않는 advancement source입니다.");

  const duplicate = existingAdvancements.find((row) => row.player_id === playerId);
  if (duplicate) errors.push("같은 Player가 이미 본선 진출 확정되어 있습니다.");
  if (finalCapacity && existingAdvancements.length >= finalCapacity) errors.push("본선 정원이 이미 충족되었습니다.");

  if (advancementType === "qualifier") {
    if (!isChampionshipQualifier(qualifierEvent)) errors.push("qualifier Event를 먼저 선택해 주세요.");
    if (!sourceEntry?.id || sourceEntry.event_id !== qualifierEvent?.id) {
      errors.push("qualifier Entry를 선택해 주세요.");
    }
    if (sourceEntry?.player_id && sourceEntry.player_id !== playerId) {
      errors.push("선택한 qualifier Entry의 Player와 advancement 대상이 다릅니다.");
    }
  }
  if (advancementType !== "qualifier" && sourceEntry) errors.push("qualifier source가 아닌 advancement에는 source Entry를 연결할 수 없습니다.");
  return errors;
}

export function buildFinalRegistrationPayload({ finalEvent, player, reason = "" } = {}) {
  const name = String(player?.display_name || player?.registration_name || "").trim();
  const generation = championshipGeneration(finalEvent);
  if (!finalEvent?.id || !player?.id || !name || !generation) throw new Error("본선 Registration에 필요한 Player identity와 Champions generation이 없습니다.");
  return {
    event_id: finalEvent.id,
    player_id: player.id,
    registration_name: name,
    registration_data: {
      champions: {
        generation,
        reason: String(reason || "").trim() || null,
      },
    },
    registration_source: "advancement",
    registered_at: new Date().toISOString(),
  };
}

export function downstreamFactsPresent({
  submissions = 0,
  entries = 0,
  entryParticipants = 0,
  matches = 0,
  results = 0,
  rankingAwards = 0,
  bracketRuntimes = 0,
  eventCompleted = false,
} = {}) {
  return Boolean(
    submissions || entries || entryParticipants || matches || results || rankingAwards || bracketRuntimes || eventCompleted
  );
}

export function advancementCancellationError(facts = {}) {
  if (downstreamFactsPresent(facts)) {
    return "본선 Registration 이후 Submission/Entry/Match/Result 등 후속 사실이 있어 advancement를 취소할 수 없습니다.";
  }
  return null;
}

export function qualifierCompletionState({ qualifierEvent, qualificationSlots, qualifiedCount } = {}) {
  if (!isChampionshipQualifier(qualifierEvent)) return { ok: false, error: "qualifier Event만 종료할 수 있습니다." };
  const slots = Number(qualificationSlots ?? qualifierEvent.qualification_slots);
  const count = Number(qualifiedCount || 0);
  if (!Number.isInteger(slots) || slots < 1) return { ok: false, error: "qualification_slots가 올바르지 않습니다." };
  if (count < slots) return { ok: false, error: `본선 진출 확정이 ${count}/${slots}명이라 qualifier를 종료할 수 없습니다.` };
  if (qualifierEvent.status === "cancelled") return { ok: false, error: "취소된 Event는 종료할 수 없습니다." };
  if (qualifierEvent.status === "completed") return { ok: true, alreadyCompleted: true };
  return { ok: true, alreadyCompleted: false };
}
