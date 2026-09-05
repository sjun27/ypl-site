const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value) => String(value || "").trim();
const LABELS = { win: "우승", ru: "준우승", sf: "4강", participant: "참가" };

export function buildIndividualPartyPreviewRows(round) {
  if (!round || round.team) return [];
  if (Array.isArray(round.individualParticipants)) {
    const rows = round.individualParticipants.map((participant) => {
      const placement = ["win", "ru", "sf"].includes(participant.placement)
        ? participant.placement
        : "participant";
      return {
        placement,
        label: LABELS[placement],
        name: clean(participant.name),
        entryId: participant.entryId || null,
        roster: participant.roster || null,
      };
    }).filter((row) => row.name);
    return ["win", "ru", "sf", "participant"].flatMap((placement) => rows.filter((row) => row.placement === placement));
  }

  const runnerUps = Array.isArray(round.ru)
    ? round.ru
    : String(round.ru || "").split("/").map(clean).filter(Boolean);
  const rows = [];
  if (clean(round.win)) rows.push({ placement: "win", label: "우승", name: clean(round.win), roster: round.partyPreviews?.win?.[0] || null });
  runnerUps.forEach((name, index) => {
    if (clean(name)) rows.push({ placement: "ru", label: "준우승", name: clean(name), roster: round.partyPreviews?.ru?.[index] || null });
  });
  asArray(round.sf).forEach((name, index) => {
    if (clean(name)) rows.push({ placement: "sf", label: "4강", name: clean(name), roster: round.partyPreviews?.sf?.[index] || null });
  });
  return rows;
}
