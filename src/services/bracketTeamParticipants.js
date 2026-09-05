function cleanText(value) {
  return String(value || "").trim();
}

function displayAnswer(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return cleanText(value);
}

const INDIVIDUAL_EVENT_DIVISIONS = ["rookie", "master", "light"];
const TEAM_EVENT_DIVISIONS = ["master", "light"];

export function getApplicationEventTypeLabel(eventType) {
  return {
    pokecup: "파이컵",
    light: "파이컵",
    champions: "챔피언스",
  }[eventType] || eventType || "대회";
}

export function getApplicationEventDivisionOptions(isTeamEvent = false) {
  return [...(isTeamEvent ? TEAM_EVENT_DIVISIONS : INDIVIDUAL_EVENT_DIVISIONS)];
}

export function normalizeApplicationEventDivision(
  division,
  isTeamEvent = false,
  { preserveLegacy = false } = {}
) {
  const value = String(division || "").trim().toLowerCase();
  if (getApplicationEventDivisionOptions(isTeamEvent).includes(value)) return value;
  if (preserveLegacy) return division || null;
  return "master";
}

export function getTeamRegistrationAnswerEntries(registration, fields = []) {
  const answers = registration?.registration_data?.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return [];

  const fieldById = new Map((fields || []).map(field => [field?.id, field]));
  const orderedKeys = [
    ...(fields || [])
      .map(field => field?.id)
      .filter(key => key && Object.prototype.hasOwnProperty.call(answers, key)),
    ...Object.keys(answers).filter(key => !fieldById.has(key)),
  ];

  return orderedKeys.map(key => ({
    key,
    label: cleanText(fieldById.get(key)?.label) || key,
    value: displayAnswer(answers[key]),
  }));
}

export function buildTeamMemberCandidates(participants = []) {
  const teams = (participants || [])
    .filter(participant => Array.isArray(participant?.members))
    .map(participant => ({
      ...participant,
      name: cleanText(participant.name),
      members: participant.members.map(cleanText).filter(Boolean),
    }))
    .filter(participant => participant.name);

  if (!teams.length) throw new Error("확정할 실제 참가 팀이 없습니다.");

  const teamIds = new Set();
  const members = [];

  for (const team of teams) {
    if (!team.id) throw new Error(`'${team.name}' 팀의 대진표 ID가 없습니다.`);
    if (teamIds.has(team.id)) throw new Error(`'${team.name}' 팀이 대진표에 중복되어 있습니다.`);
    if (!team.members.length) throw new Error(`'${team.name}' 팀에 참가 선수가 없습니다.`);
    teamIds.add(team.id);

    team.members.forEach((name, index) => {
      members.push({
        id: `${team.id}:member:${index + 1}`,
        teamParticipantId: team.id,
        teamName: team.name,
        memberOrder: index + 1,
        role: index === 0 ? "captain" : null,
        name,
      });
    });
  }

  return { teams, members };
}

export function attachConfirmedTeamIdentities(teams = [], resolvedMembers = []) {
  return teams.map(team => {
    const members = resolvedMembers
      .filter(member => member.teamParticipantId === team.id)
      .sort((a, b) => a.memberOrder - b.memberOrder);
    const entryIds = [...new Set(members.map(member => member.entryId).filter(Boolean))];

    const hasCanonicalOrder = members.every((member, index) =>
      member.memberOrder === index + 1 && member.name === team.members[index]
    );
    if (members.length !== team.members.length || entryIds.length !== 1 || !hasCanonicalOrder) {
      throw new Error(`'${team.name}' 팀의 normalized identity를 모두 연결하지 못했습니다.`);
    }

    return {
      ...team,
      entryId: entryIds[0],
      memberIdentities: members.map(member => ({
        name: member.name,
        memberOrder: member.memberOrder,
        role: member.memberOrder === 1 ? "captain" : null,
        registrationId: member.registrationId,
        playerId: member.playerId,
        entryParticipantId: member.entryParticipantId,
      })),
    };
  });
}

export function getConfirmedTeamMemberIdentities(team) {
  const members = [...(team?.memberIdentities || [])]
    .sort((a, b) => a.memberOrder - b.memberOrder);
  const declaredMembers = (team?.members || []).map(cleanText).filter(Boolean);

  if (
    !members.length ||
    (declaredMembers.length > 0 && members.length !== declaredMembers.length) ||
    new Set(members.map(member => member?.name)).size !== members.length ||
    members.some((member, index) =>
      member?.memberOrder !== index + 1 ||
      !member?.name ||
      !member?.playerId ||
      (declaredMembers.length > 0 && member.name !== declaredMembers[index])
    )
  ) {
    throw new Error(`'${team?.name || "알 수 없는 팀"}' 팀의 확정 선수 순서 또는 Player identity가 올바르지 않습니다.`);
  }

  const explicitCaptains = members.filter(member => member.role === "captain");
  if (
    explicitCaptains.length > 1 ||
    (explicitCaptains.length === 1 && explicitCaptains[0].memberOrder !== 1) ||
    members.slice(1).some(member => member.role === "captain")
  ) {
    throw new Error(`'${team?.name || "알 수 없는 팀"}' 팀의 captain 역할이 중복되었거나 선수 순서와 일치하지 않습니다.`);
  }

  return members.map(member => ({
    ...member,
    role: member.memberOrder === 1 ? "captain" : null,
  }));
}

export function getFixedTeamLineup(team) {
  if (team?.memberIdentities?.length) {
    return getConfirmedTeamMemberIdentities(team).map(member => member.name);
  }
  return (team?.members || []).map(cleanText).filter(Boolean);
}

export function getTeamMatchLineupOptions(team) {
  if (team?.memberIdentities?.length) {
    return getConfirmedTeamMemberIdentities(team).map(member => ({
      value: member.name,
      label: member.memberOrder === 1 ? `${member.name} (팀장)` : member.name,
    }));
  }
  return getFixedTeamLineup(team).map((name, index) => ({
    value: name,
    label: index === 0 ? `${name} (팀장)` : name,
  }));
}

export function buildDefaultTeamMatchLineups(teamA, teamB) {
  const rosterA = getFixedTeamLineup(teamA);
  const rosterB = getFixedTeamLineup(teamB);
  const normalBoutCount = Math.max(rosterA.length, rosterB.length);
  return {
    normalBoutCount,
    lineupA: Array.from({ length: normalBoutCount }, (_, index) => rosterA[index] || null),
    lineupB: Array.from({ length: normalBoutCount }, (_, index) => rosterB[index] || null),
    captainA: rosterA[0] || null,
    captainB: rosterB[0] || null,
  };
}

export function buildTeamMatchSeries(
  teamA,
  teamB,
  { lineupA = [], lineupB = [], games = [], ace = null } = {}
) {
  const optionsA = new Set(getTeamMatchLineupOptions(teamA).map(option => option.value));
  const optionsB = new Set(getTeamMatchLineupOptions(teamB).map(option => option.value));
  const boutCount = buildDefaultTeamMatchLineups(teamA, teamB).normalBoutCount;
  const actualLineupA = (Array.isArray(lineupA) ? lineupA : []).slice(0, boutCount);
  const actualLineupB = (Array.isArray(lineupB) ? lineupB : []).slice(0, boutCount);
  const boutGames = (Array.isArray(games) ? games : []).slice(0, boutCount);

  if (
    !boutCount ||
    actualLineupA.length !== boutCount ||
    actualLineupB.length !== boutCount ||
    boutGames.length !== boutCount ||
    actualLineupA.some(name => !optionsA.has(name)) ||
    actualLineupB.some(name => !optionsB.has(name)) ||
    boutGames.some(winner => winner !== "a" && winner !== "b")
  ) {
    throw new Error("모든 팀전 lineup 선수와 일반 경기 승자를 입력해 주세요.");
  }

  const winsA = boutGames.filter(winner => winner === "a").length;
  const winsB = boutGames.length - winsA;
  const tied = winsA === winsB;
  if (
    tied &&
    (!ace || !optionsA.has(ace.a) || !optionsB.has(ace.b) || (ace.winner !== "a" && ace.winner !== "b"))
  ) {
    throw new Error("동점이면 에이스 선수와 승자를 모두 선택해 주세요.");
  }

  const winnerSide = tied ? ace.winner : winsA > winsB ? "a" : "b";
  return {
    winnerSide,
    series: {
      lineupA: actualLineupA,
      lineupB: actualLineupB,
      games: boutGames,
      ace: tied ? { a: ace.a, b: ace.b, winner: ace.winner } : null,
    },
  };
}
