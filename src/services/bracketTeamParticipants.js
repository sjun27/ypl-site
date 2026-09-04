function cleanText(value) {
  return String(value || "").trim();
}

function displayAnswer(value) {
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return cleanText(value);
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

    if (members.length !== team.members.length || entryIds.length !== 1) {
      throw new Error(`'${team.name}' 팀의 normalized identity를 모두 연결하지 못했습니다.`);
    }

    return {
      ...team,
      entryId: entryIds[0],
      memberIdentities: members.map(member => ({
        name: member.name,
        memberOrder: member.memberOrder,
        registrationId: member.registrationId,
        playerId: member.playerId,
        entryParticipantId: member.entryParticipantId,
      })),
    };
  });
}
