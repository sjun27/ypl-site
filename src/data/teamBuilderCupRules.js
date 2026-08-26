// YPL Pi Cup rules
// Add announced Pi Cup formats here without changing Regulation data.

export const TYPE_OPTIONS = [
  { id: 'normal', english: 'Normal', korean: '노말' },
  { id: 'fire', english: 'Fire', korean: '불꽃' },
  { id: 'water', english: 'Water', korean: '물' },
  { id: 'electric', english: 'Electric', korean: '전기' },
  { id: 'grass', english: 'Grass', korean: '풀' },
  { id: 'ice', english: 'Ice', korean: '얼음' },
  { id: 'fighting', english: 'Fighting', korean: '격투' },
  { id: 'poison', english: 'Poison', korean: '독' },
  { id: 'ground', english: 'Ground', korean: '땅' },
  { id: 'flying', english: 'Flying', korean: '비행' },
  { id: 'psychic', english: 'Psychic', korean: '에스퍼' },
  { id: 'bug', english: 'Bug', korean: '벌레' },
  { id: 'rock', english: 'Rock', korean: '바위' },
  { id: 'ghost', english: 'Ghost', korean: '고스트' },
  { id: 'dragon', english: 'Dragon', korean: '드래곤' },
  { id: 'dark', english: 'Dark', korean: '악' },
  { id: 'steel', english: 'Steel', korean: '강철' },
  { id: 'fairy', english: 'Fairy', korean: '페어리' },
];

export const CUP_RULES = {
  none: {
    id: 'none',
    name: '추가 룰 없음',
    shortName: '일반',
    kind: 'none',
    description: '선택한 Regulation의 기본 규정만 적용합니다.',
  },
  'monotype-challenge': {
    id: 'monotype-challenge',
    name: '모노타입 챌린지',
    shortName: '모노타입',
    kind: 'monotype',
    description: '룰렛으로 배정받은 타입을 하나 이상 가진 포켓몬만 파티에 넣을 수 있습니다.',
    selector: {
      id: 'assignedType',
      label: '배정 타입',
      placeholder: '타입을 선택하세요',
      options: TYPE_OPTIONS,
    },
  },
};

