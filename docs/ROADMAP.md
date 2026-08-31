# YPL 개발 로드맵

> 이 문서는 **현재 상태와 다음 작업만** 관리합니다.
>
> - 과거 변경 이력: `docs/PATCH_NOTES_2026-08-26.md`
> - 기술 구조·데이터 모델·운영 원칙: `docs/ARCHITECTURE.md`

마지막 업데이트: 2026-08-31

---

# 1. 현재 상태

YPL 사이트는 현재 세 영역으로 운영합니다.

```text
YPL Tools
└─ Team Builder

YPL 대회 운영
├─ 참가 / 엔트리
├─ 대진표
└─ 기록 반영

YPL Records
├─ 트레이너
├─ 대회
├─ 포켓몬
└─ 랭킹
```

현재 개발 초점은 다음 순서입니다.

```text
Records 안정화
→ 운영 Supabase 백업·조사
→ Team Builder Team Snapshot 규격 확정
→ Replica Team ID 매핑 가능성 검증
→ 데이터 모델 정규화
→ Team Builder와 대회 운영 연결
→ 칭호·명예의 전당 자동화
```

**DB schema 확정 전 선행 원칙**

Replica Team ID Import 기능 전체를 먼저 완성한 뒤 DB를 만드는 것은 필수가 아닙니다.

대신 DB schema를 확정하기 전에 다음 두 가지를 먼저 끝냅니다.

1. Team Builder가 보존해야 할 전체 팀 정보의 canonical **Team Snapshot 규격 확정**
2. Pokémon Champions Replica Team ID에서 불러온 정보를 같은 Team Snapshot 구조로 변환할 수 있는지 검증

즉:

```text
Team Builder 직접 입력 ─┐
                       ├→ canonical Team Snapshot → 대회 Entry
Replica Team ID Import ─┘
```

Import UI와 사용자 흐름의 완성은 정규화 DB 구축 이후여도 무방합니다.

## 완료된 기반

- 페이지 / 공통 컴포넌트 / 관리자 / 서비스 계층 분리
- Team Builder 본사이트 통합 및 기존 핵심 기능 복원
- Team Builder 개인 팀 localStorage 저장
- Team Builder 저장 정보: Regulation / Cup Rule / 포켓몬 / 특성 / 성격(Alignment) / Stat Points / 도구 / 기술 4개
- Records 1차 UI: `트레이너 / 대회 / 포켓몬 / 랭킹`
- 대진표 → 회차 / 랭킹 / 시즌 성적 연동
- 기록 반영 취소 및 원복
- 기록 반영 완료 대진표 잠금
- YPL 시즌 3 이후 개인전·팀전 Match 원본 보존
- 팀전 선발 경기 및 에이스 결정전 Match 보존
- 반영 완료 대진표의 전체 참가자 대회 이력 생성
- 팀전 우승·준우승·4강을 트레이너 입상 기록에 포함
- 개인 승/패·승률·Rival 기본 공개 제거
- 챔피언스 시리즈 회차는 저장된 `round` 값을 그대로 사용

## 운영 데이터

현재 운영 데이터의 기준 원본:

```text
Supabase
site_data
key = ypl_data_v4
```

GitHub의 SEED는 운영 Supabase와 다를 수 있으며 운영 원본으로 보지 않습니다.

**2026-08-29 기준 GitHub 및 Supabase 프로젝트 접근권한 확보 완료.**

---

# 2. Records 정책

## 2.1 과거 기록

과거 자료는 확인 가능한 범위만 보존합니다.

- 전체 대진표가 없으면 경기 승패를 추정하지 않음
- 우승 / 준우승 / 4강만 남아 있으면 해당 기록만 유지
- 누락된 참가자나 경기 결과를 임의로 복원하지 않음

## 2.2 YPL 시즌 3 이후

기록에 반영된 대진표를 원본으로 사용합니다.

보존 대상:

- 참가자
- 최종 대회 성적
- 상대
- 경기 승자 / 패자
- 경기 단계
- 팀전 선발 경기
- 에이스 결정전
- 등록 엔트리

BYE는 실제 경기로 기록하지 않습니다.

## 2.3 트레이너 공개 기록

기본 공개:

- 확인 가능한 참가 횟수
- 우승 / 준우승 / 4강 — **팀전 포함**
- 전체 대회 이력
- 등록 엔트리
- 칭호
- 명예의 전당

기본 미공개:

- 개인 승 / 패
- 승률
- Rival / Head-to-Head
- 연승 등 평가성 파생 지표

Match 원본은 유지하므로 필요하면 향후 내부 통계로 다시 계산할 수 있습니다.

## 2.4 대회 이력 표기

반영 완료 대진표가 있는 경우 모든 참가자의 최종 성적을 표시합니다.

```text
싱글 엘리미네이션
우승 / 준우승 / 4강 / 8강 / 16강 ...

더블 엘리미네이션
우승 / 준우승 / 3위 / 4위 / 공동 5위 ...

조별리그 + 본선
본선 도달 성적 / 조별리그 탈락

팀전
팀 우승 / 팀 준우승 / 팀 4강 / 팀 8강 ...
```

## 2.5 챔피언스 시리즈

회차 번호의 source of truth는 대회 회차에 저장된 `round` 값입니다.

```text
round = 8
champ = true
→ 챔피언스 시리즈 8회
```

`champ`는 챔피언스 시리즈 여부만 판단하며 별도 번호를 계산하지 않습니다.

---

## 2.6 정규화 전 확정 정책

### 팀전 입상

- 팀전 우승 / 준우승 / 4강도 각 팀원의 공식 입상 경력으로 인정
- 개인전 입상과 팀전 입상은 내부적으로 구분 저장
- 전체 통계와 시즌별 통계에서는 필요에 따라 합산 가능

### 팀전 포인트

현재 기록 반영 UI의 기본 배점:

```text
우승   60
준우승 40
4강    20
```

- 팀전은 등수별 총점을 팀원 수로 균등분배하는 것을 기본값으로 사용
- 운영자가 팀원별 포인트를 개별 조정할 수 있음
- 정규화 이후에는 재계산값이 아니라 **최종 확정된 개인별 실제 지급값**을 보존
- 회차 수정 시 custom point가 균등분배값으로 되돌아가는 문제는 RankingAward / scoring ledger 구조에서 해결

### 날짜와 연결

- 신규 대회는 가능한 한 정확한 `YYYY-MM-DD` 날짜 저장
- 과거 자료는 확인 가능한 날짜 정밀도까지만 보존하고 임의의 일자를 생성하지 않음
- 대진표 ↔ Event / Result 연결에 날짜 문자열을 식별자로 사용하지 않음
- 영구 ID로 연결

### Season

- Season은 단순 문자열 필터가 아니라 정규화 DB의 독립 엔티티로 관리
- Event가 `season_id`를 참조
- Entry / Match / Result는 Event를 통해 시즌에 연결
- 시작일 / 종료일은 알 수 있을 때만 저장하고 과거 불명 값은 NULL 허용

# 3. 우선순위

## P0. 운영 데이터 백업 및 인벤토리

**대부분 완료. 세부 diff만 남음.**

Supabase 권한 확보가 완료되어 기존 선행조건이 해소됐습니다.

순서:

1. 운영 `site_data / ypl_data_v4` 원본 백업 — 완료
2. 현재 Supabase 테이블 / RLS / Auth 상태 확인 — 완료
3. 실제 운영 데이터 구조 인벤토리 작성 — 완료
4. GitHub SEED와 운영 데이터 차이 확인 — 진행 필요
5. 과거 대진표·회차 데이터 복구 가능 범위 분류 — 1차 완료

현재 확인된 과거 대회 복구 품질:

```text
full_match   3회
placement   48회
winner_only  6회
```

확보한 운영 원본 백업을 migration 기준점으로 유지하며, 운영 데이터 migration이나 schema 변경은 별도 테스트 환경에서 검증한 뒤 진행합니다.

## P1. Records 1차 시스템 마무리

- 트레이너 기록 회귀 테스트
- 팀전 전체 이력 및 Match 추출 검증
- 싱글 / 더블 / 조별리그 최종 성적 분류 검증
- 대회 아카이브 표시 점검
- 포켓몬 기록 집계 점검
- 시즌 / 대회 필터 정리
- 대진표 연동 회차의 직접 편집 정책 확정
- 팀전 custom point 재동기화 문제를 새 데이터 모델에서 해결
- 날짜 변경 시 대진표 연결이 끊어지는 legacy 연결 방식 제거

실제 시즌 3 운영에서 데이터를 쌓으면서 예외 케이스를 확인합니다.

## P1.5. Team Builder Team Snapshot 계약 확정

정규화 DB schema를 최종 확정하기 전에 진행합니다.

현재 Team Builder의 canonical 팀 정보:

```text
Team
├─ regulationId
├─ cupRuleId / cupRuleSettings
└─ members[0..5]
   ├─ pokemonName
   ├─ ability
   ├─ alignment / nature
   ├─ statPoints
   ├─ item
   └─ moves[0..3]
```

할 일:

- Team Snapshot schema version 확정
- 개인 Team Builder 저장본과 대회 제출 Snapshot을 분리
- 제출 Snapshot은 이후 개인 Team Builder 수정과 무관한 기록으로 보존
- Pokémon / 특성 / 성격 / Stat Points / 도구 / 기술 4개를 canonical Snapshot의 핵심 전투 정보로 사용
- IV는 Pokémon Champions에서 고정되는 값이므로 Snapshot에 별도 저장하지 않음
- Tera Type은 향후 Regulation에서 필요할 수 있으나 현재 Mega Rule에서는 보류하고, 새 Regulation 공개 후 실제 규칙을 확인해 Snapshot schema 확장을 검토
- Replica Team ID Import가 위 canonical 구조로 변환 가능한지 실제 데이터로 검증
- Replica Import에서 추가 메타데이터가 필요하면 `source_type`, `source_code`, `imported_at` 등을 별도 보존
- Import 구현 세부가 바뀌어도 Event / Entry schema를 다시 뜯지 않도록 Snapshot 경계를 먼저 확정

**Replica Team ID Import UI 전체 구현은 DB 정규화 이후 진행해도 무방합니다.**

### Team Snapshot v1 canonical contract

목표:

> Snapshot 하나만으로 당시 제출 팀을 Team Builder에서 동일한 세팅으로 다시 열 수 있어야 한다.

Team Snapshot v1은 개인 Team Builder 저장 포맷과 DB 테이블 구조 자체가 아니라, 직접 작성 / Replica Import / 과거 팀 복원 경로가 공통으로 변환되는 canonical domain contract로 사용합니다.

```text
TeamSnapshot v1
├─ schemaVersion
├─ regulationId
├─ cupRuleId
├─ cupRuleSettings
├─ source
│  ├─ type
│  ├─ reference nullable
│  └─ importedAt nullable
└─ members[1..6]
   ├─ slot
   ├─ pokemonId
   ├─ pokemonNameSnapshot
   ├─ abilityId nullable
   ├─ natureId nullable
   ├─ statPoints
   │  ├─ hp
   │  ├─ atk
   │  ├─ def
   │  ├─ spa
   │  ├─ spd
   │  └─ spe
   ├─ itemId nullable
   └─ moves[4] nullable
```

정책:

- 공식 제출은 Pokémon 1마리 이상 필요
- 1~6마리 제출 가능
- `Team Invalid`만 제출 차단
- `Team Incomplete`는 공식 제출 가능
- 일부 Ability / Item / Move 등이 비어 있어도 Regulation 위반이 아니면 Snapshot으로 보존 가능
- Stat Points는 실제 입력 원본값을 저장하고 계산된 최종 능력치는 저장하지 않음
- IV는 Pokémon Champions에서 고정되므로 저장하지 않음
- Tera Type은 현재 Mega Rule에서는 v1에 포함하지 않고 향후 Regulation 공개 후 schema 확장 검토
- UI 선택 상태 / 검색 상태 / sprite URL / 계산 결과는 Snapshot에 저장하지 않음
- 모노타입 `assignedType`은 참가자가 Team Builder에서 직접 선택하고 localStorage/validation에만 사용하며 DB/Snapshot/Records에는 저장하지 않음
- 개인 Team Builder의 저장용 팀 이름은 canonical 전투 세팅의 식별값으로 사용하지 않음
- 대회 Entry 표시명 등 운영용 이름이 필요하면 Entry 계층에서 별도로 관리

#### Pokémon 식별

현재 Team Builder의 `speciesIdentity()`는 동일 도감번호 / 동일 종 중복 판정용으로 사용되므로 Snapshot 복원용 Pokémon ID와 역할을 분리합니다.

Snapshot의 `pokemonId`는 리전폼 / 폼체인지까지 구분 가능한 stable form-specific canonical ID를 사용해야 합니다.

예:

```text
Dragonite       → dragonite
Wash Rotom      → rotomwash
Hisuian Zoroark → zoroarkhisui
```

`pokemonNameSnapshot`은 당시 입력 / 소스 표현을 보존하기 위한 보조 정보이며 통계 연결의 기본 키로 사용하지 않습니다.

#### Source provenance

`source.type` 후보:

- `manual`
- `replica_import`
- `historical`

Replica ID는 Snapshot 자체의 ID가 아니라 출처 reference로만 취급합니다.

Replica Import 후 사용자가 세팅을 수정하더라도 최종 전투 사실은 Snapshot 내부 값이 source of truth이며, Replica ID는 해당 팀의 출발점에 대한 provenance입니다.

### Replica Team ID mapping 검증 상태

확인된 사항:

- Pokémon Champions Replica Team은 전체 팀 구성을 복제하는 기능
- 공개 자료 기준 Pokémon / Held Item / Ability / Nature / Moves / Stat Points가 Replica Team에 포함됨
- 따라서 위 Team Snapshot v1 핵심 전투 필드와 의미상 매핑 가능
- Regulation / Season 정보도 외부 Replica Team DB에서 별도 관리되는 사례가 있음

아직 미확인:

- 임의의 10자리 Replica Team ID를 입력했을 때 전체 팀 세팅을 JSON 등 구조화 데이터로 반환하는 공식 또는 안정적인 공개 API 존재 여부
- 해당 조회 기능을 브라우저 클라이언트에서 직접 사용할 수 있는지 여부
- 코드 만료 / Regulation 변경 / 비공개 팀 등 예외 처리 방식

따라서 **Team Snapshot v1 계약 확정과 Replica Import 조회 구현을 분리**합니다.

```text
현재
→ Snapshot field mapping 가능성 확인

다음 기술 검증
→ Replica ID → full team data retrieval 경로 확인

retrieval 경로 확보 후
→ Replica Import adapter
→ Team Snapshot v1
→ 기존 Team Builder load path
```

조회 경로가 확정되기 전에는 특정 비공식 서비스의 내부 API에 DB 구조를 종속시키지 않습니다.

## P2. 데이터 모델 정규화

<!-- YPL_P2_MODEL_STATUS_START -->
### 정규화 논리 모델 최신 revision — 2026-08-31

기존 normalized schema와 legacy migration은 Registration 도입 전 모델에서 테스트 검증을 완료했다.

최신 논리 구조:

```text
Player
Season
Event
EventRegistration
RegistrationSubmission
TeamSnapshot
TeamSnapshotMember
Entry
EntryParticipant
Match
Result
RankingAward
RankingBaseline
TitleDefinition
TitleAward
PlayerPartner
HallOfFameEntry
ChampionshipAdvancement
```

핵심 확정 사항:

- `EventRegistration` = 참가 신청 및 제출 기준 단위
- `Entry` = 실제 대진표 참가 단위
- 신청과 Entry를 분리하여 팀전 사후 편성을 지원
- Submission은 대진표/팀 편성 전에도 가능하도록 EventRegistration에 귀속
- 재제출 revision 보존, 결과 적용 시 Registration.final_submission_id 확정
- 파티 제출 Snapshot은 Pokémon 목록만이 아니라 **특성 / 성격 / Stat Points / 지닌물건 / 기술 4개**까지 전체 세팅 보존
- Team Invalid만 제출 차단, Team Incomplete 허용
- Snapshot v1에 IV/Tera 제외
- 모노타입 assignedType은 로컬 전용, DB/Snapshot 저장 안 함
- Team Snapshot immutable
- 팀전 Result는 팀 Entry에 한 번만 저장
- 선수별 실제 포인트는 RankingAward에 개별 저장
- 과거 복원 불가능 랭킹은 RankingBaseline으로 보존
- Champions qualifier/final은 별도 Event이며 Snapshot 공유 안 함
- ChampionshipAdvancement는 본선 Entry가 아니라 **본선 EventRegistration**을 대상으로 기록하여 대진표 생성 전 제출을 지원
- legacy historical submission은 migration-source Registration anchor를 사용하되 실제 과거 신청 사실로 집계하지 않음

다음 단계:

```text
최신 DDL
→ migration generator 갱신
→ YPL_DB_Test 재생성
→ ypl_data_v4 migration 회귀
→ 신규 Registration flow 테스트
→ 운영 migration
```
<!-- YPL_P2_MODEL_STATUS_END -->

기존 `ypl_data_v4`는 새 정규화 구조가 검증되기 전까지 유지하며, 테스트 migration과 대조를 거쳐 점진적으로 이전합니다.


## 챔피언스 선발전 / 본선 모델 확장

정규화 DB 및 대회 운영 기능에 다음 구조를 추가합니다.

- 챔피언스 선발전과 본선을 **서로 다른 Event**로 저장
- 같은 챔피언스 회차의 선발전 / 본선을 연결할 수 있는 관계 추가
- 선발전 Event에 회차별 `qualification_slots` 저장
- 운영자가 당시 시즌 순위와 운영 규정을 보고 본선 직행자를 직접 결정
- 선발전 통과자 / 랭킹 직행자 / 운영상 예외 진출 경로 기록
  - `ranking`
  - `qualifier`
  - `manual`
- 선발전과 본선의 EventRegistration / Entry / RegistrationSubmission / TeamSnapshot은 완전히 독립
- 선발전 통과/랭킹 직행 확정 시 본선에 `registration_source = advancement` Registration 생성
- 본선 파티는 그 Registration에 새로 제출
- 본선 Entry는 실제 본선 대진표 생성 시 별도로 생성
- 선발전 Match는 트레이너 승 / 패 기록에 포함
- 선발전에는 우승 / 준우승 / 4강 Result를 생성하지 않음
- 선발전에는 RankingAward / HallOfFameEntry를 생성하지 않음
- 지정된 본선 진출자 수가 확정되면 선발전을 종료할 수 있도록 대진표 처리 확장
- 과거 선발전 자료가 없는 챔피언스 회차는 역추정하지 않음

구현 순서:

```text
1. Event의 챔피언스 phase / 회차 연결 방식 확정
2. 본선 진출 관계 스키마 확정
3. normalized_schema_v1.sql 반영
4. YPL_DB_Test에서 빈 DB 재생성 테스트
5. 기존 migration 재실행 및 회귀 검증
6. 관리자 선발전 / 본선 참가자 관리 UX 구현
7. 선발전 대진표의 N명 선발 종료 처리 구현
```

## P3. 신청 → Team Builder 제출 → 대진표

### 대회 신청

- 대회 신청 공지를 만들 때 Event를 생성/연결
- Event의 regulation / cup rule / 공통 rule settings가 규칙 source of truth
- 신청 완료 시 EventRegistration 생성
- 팀전 1·2·3지망 등 대회별 답변은 registration_data에 저장
- 참가자는 파티 제출 시 해당 Event를 선택하고 **자기 이름을 직접 입력**
- 해당 Event의 제출 가능 Registration(`application / advancement / manual`)과 exact match
- 개인 링크/token/별도 회원 로그인은 만들지 않음

### 파티 제출

- 신청 직후부터 제출 가능
- 대진표 생성 전/후 모두 재제출 가능
- 결과 적용 전까지 제출 가능
- 결과 적용 시 final_submission_id freeze
- 제출 revision과 제출 시각 전체 보존
- Pokémon 1~6마리
- Team Invalid만 제출 차단
- Team Incomplete 허용
- Snapshot은 포켓몬 / 특성 / 성격 / Stat Points / 지닌물건 / 기술 4개를 모두 보존
- 개인 Team Builder localStorage와 공식 제출 Snapshot은 분리

### 운영자 제출 관리

대진표 참가자 목록에서 다음을 바로 확인할 수 있게 한다.

```text
미제출
제출 완료
기준 시각 이후 제출
최종 제출 시각
```

파티 미제출은 대진표 참가를 막지 않는다.

### 참가 확정 / Entry 생성

기존 `대진표 → 새 대회 만들기` UX 큰 틀은 유지한다.

```text
기존 Event 선택
→ 신청자 전원 기본 체크
→ 불참자만 체크 해제
→ 대진표 생성
→ 실제 Entry / EntryParticipant 생성
```

별도 참가 확정 화면과 참가 취소 UI는 만들지 않는다.

Bracket participant identity는 이름/party 복사본이 아니라 Entry ID를 기준으로 전환한다.

### 팀전 편성

기존 1·2·3지망 방식 유지.

자동 추천 기준:

1. 팀 인원을 최대한 균등하게 배치
2. 전체 참가자의 1·2·3지망 만족도 최대화

실력 밸런스는 시스템에서 계산하지 않는다.

추천안은 여러 번 재생성할 수 있고 운영진이 최종 수정한다.

운영진 수동 이동 UI에서는 참가자별 1·2·3지망 전체와 현재 배정이 몇 지망인지 상시 표시한다.

최종 확정 후 Team Entry / EntryParticipant를 생성하며 팀원 수는 고정하지 않는다.

### 에이스전

- 실제 정규 개인전 수 홀수 → 동률 불가 → ace 없음
- 실제 정규 개인전 수 짝수 → 동률 가능
- 실제 동률일 때만 ace Match 생성

### 팀 세팅 공개

일반 대회:

```text
결과 적용
→ Match / Result / RankingAward 확정
→ final submission freeze
→ team_revealed_at
→ Records 공개
```

Records Event 상세에서 결과 / 대진표 / 참가자 / 최종 공개 파티를 함께 조회한다.

과거 revision은 공개하지 않고 운영 이력으로 보존한다.

## P4. 대회 종료 자동화

- 결과 적용 → Match / Result / RankingAward 확정
- EventRegistration.final_submission_id freeze
- 일반 대회 최종 파티 자동 공개
- Records 대회 상세 자동 연결 강화
- Champions 본선 우승 → HallOfFameEntry 자동 연결
- 신규 HOF Pokémon 파티는 winner final TeamSnapshot의 pokemon_id sprite로 렌더링
- 기존 image_ref는 legacy/custom 호환용만 유지
- 기록 → 칭호 AUTO / REVIEW 후보

## P5. Team Builder 추가 기능

- 과거 우승 팀을 Team Builder에서 열기
- 저장 팀 공유 / 복제 등 추가 UX 검토

---

# 4. 보류·추후 결정

## Battle Data — 보류

여기서 Battle Data는 YPL 내부 기록이 아니라 **Pokémon Champions 전체 메타 통계**입니다.

전문 서비스가 이미 존재하고 데이터 수집·유지 비용이 크므로 현재 우선순위에서는 제외합니다.

## 파이컵 Light의 공식 W/L 범위 — 추후 결정

대회 / Entry / Match 원본은 보존합니다.

개인 승패를 기본 공개하지 않으므로 내부 ‘공식 전적’에 포함할지는 필요할 때 결정합니다.

## 팀전 개인 경기의 공식 W/L 범위 — 추후 결정

팀전 우승·준우승·4강은 트레이너 입상 기록에 포함합니다.

팀전 개별 경기와 에이스 결정전도 Match 원본으로 보존합니다.

다만 향후 개인 통산 W/L을 만들 경우 개인전 Match와 합산할지는 별도 정책으로 결정합니다.

## Tera Type Snapshot 확장 — Regulation 공개 후 결정

현재 적용 Regulation은 Mega Rule이므로 Team Snapshot v1에 Tera Type을 당장 추가하지 않습니다.

향후 Tera를 사용하는 Regulation이 공개되면 실제 Pokémon Champions 규칙과 Team Builder 입력 요구사항을 확인한 뒤 Snapshot schema를 확장합니다.

IV는 Pokémon Champions에서 고정되므로 별도 저장 대상으로 두지 않습니다.

## RankingAward 수정 이력 — 추후 결정

정규화 이후 실제 지급값 자체는 반드시 보존합니다.

운영자가 포인트를 수정했을 때:

```text
기존 Award 값을 수정
vs
원 지급 + 조정 delta를 ledger로 추가
```

중 어느 방식을 사용할지는 schema 확정 시 결정합니다.

## Rival / 연승 공개 — 보류

Match 원본으로 계산은 가능하지만 기본 프로필에서는 공개하지 않습니다.

## 포인트 랭킹 — 현행 유지

기존 포인트 랭킹은 Records의 경기 원본 및 트레이너 성적과 별개의 지표로 유지합니다.

---

# 5. 운영 안전 원칙

- 운영 데이터 기준 원본은 Supabase `ypl_data_v4`
- GitHub SEED를 운영 원본으로 간주하지 않음
- 운영 데이터 변경 전 백업
- 과거 기록을 추측해 생성하지 않음
- 통계 숫자보다 Match / Entry / Result 원본 사실을 우선 저장
- 개인 Team Builder 저장본을 대회 엔트리 원본으로 직접 참조하지 않고 제출 당시 Snapshot을 고정
- 베타 GitHub Pages에서 관리자 저장 기능 사용 금지
- 대진표 결과 수정은 기본적으로 `반영 취소 → 수정 → 재반영`

상세 기술 구조와 migration 원칙은 `docs/ARCHITECTURE.md`에서 관리합니다.

---

# 6. 바로 다음 작업

```text
완료: normalized_schema_v1.sql 최신 구조 Test schema 적용
완료: EventRegistration / RegistrationSubmission 기반 legacy migration generator 작성
완료: ypl_data_v4 전체 migration 회귀 검증
완료: count / identity / Result / RankingBaseline / Snapshot / Match / Title / Partner / HOF 검증
완료: 신규 Registration → Submission → Entry → Result freeze happy-path 검증
완료: 팀전 지망 데이터 / 수동 배정 구조 / ace Match 구조 검증

다음 작업:
1. generator / DDL / 문서 최종 diff 검토
2. 랭킹 반영 정책(rankingEnabled) 신규 Event 생성·결과 반영 코드에 적용
3. 현재 legacy 프론트의 파트너 Pokémon Player 검색 오염 수정
4. normalized DB를 사용하는 애플리케이션 연결 구현
5. 전체 회귀 테스트 후 Production migration 계획 확정
```

Replica Team ID Import UI는 운영 흐름 안정화 이후 진행해도 무방합니다.
