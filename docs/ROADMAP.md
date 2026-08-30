# YPL 개발 로드맵

> 이 문서는 **현재 상태와 다음 작업만** 관리합니다.
>
> - 과거 변경 이력: `docs/PATCH_NOTES_2026-08-26.md`
> - 기술 구조·데이터 모델·운영 원칙: `docs/ARCHITECTURE.md`

마지막 업데이트: 2026-08-30

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

## P2. 데이터 모델 정규화

P0 운영 데이터 인벤토리를 마무리하고 P1.5 Team Snapshot 계약을 확정한 뒤 진행합니다.

목표 객체:

```text
Player
Season
Event
Entry
Team Snapshot / Entry Pokémon
Match
Result
RankingAward
Title Award
Hall of Fame
```

객체 책임:

```text
Season
= 어느 시즌인가

Event
= 실제 한 번 열린 대회

Entry
= 누가 해당 Event에 참가했는가

Team Snapshot
= 제출 당시 포켓몬 전체 세팅의 고정본

Match
= 실제 경기 사실

Result
= Event의 공식 최종 성적

RankingAward
= 실제 지급된 랭킹 포인트·입상 delta
```

기존 `ypl_data_v4`를 즉시 제거하지 않고 새 구조와 병행한 뒤 점진적으로 이전합니다.

## P3. Team Builder → 대회 엔트리

- Team Builder에서 실제 YPL 대회 엔트리 제출
- 포켓몬 / 특성 / 성격 / Stat Points / 도구 / 기술까지 제출 Snapshot에 보존
- 개인 Team Builder 수정과 대회 제출본을 분리
- 제출 마감 전에는 자유롭게 재제출 가능
- 재제출 시 최신 제출본을 현재 공식 제출본으로 사용하고, 마감 시점에 최종본을 고정
- 마감 이후 참가자 임의 수정 불가
- Team Builder의 `Team Invalid` 상태는 제출 차단
- `Team Incomplete` 상태는 제출 허용
  - 포켓몬 수를 6마리보다 적게 제출하는 경우
  - 기술을 의도적으로 4개보다 적게 채용하는 경우
  - 그 밖에 일부 세팅이 비어 있더라도 Regulation 위반이 아닌 경우
  - 즉 대회 제출 차단 기준은 `Team Invalid`로 한정
- 대진표 참가자와 Entry 연결
- Replica Team ID로 불러온 팀도 동일한 제출 경로 사용
- Replica Team ID Import UI 및 실제 사용자 흐름 완성

### 대회 운영자 제출 관리

대회 진행자는 대회 시작 전까지 참가자 제출 상태를 확인할 수 있어야 합니다.

필요 기능:

- 참가자별 제출 여부 확인
- 최종 제출 시각 확인
- 현재 공식 제출본 확인
- 제출된 전체 팀 세팅 확인
- 재제출 발생 시 최신본 반영 여부 확인
- 제출 마감 상태 확인
- 마감 이후 참가자 수정 차단 여부 확인

이 기능은 향후 Event / Entry / Team Snapshot 구조 위에서 관리자용 대회 운영 화면으로 구현합니다.

### 팀 세팅 공개 정책

기본 원칙:

```text
일반 YPL 대회
→ 대회 종료 후 공개

챔피언스 시리즈
→ 대회 직전 공개
```

- 제출 마감 전/후와 공개 시점은 별개의 상태로 관리
- 운영진은 공개 전에도 운영상 필요한 제출 정보를 확인할 수 있어야 함
- 일반 참가자에게는 Event의 공개 정책에 따라 팀 세팅을 노출

## P4. 대회 종료 자동화

- Champions 우승 → 명예의 전당 등록 후보
- 기록 → 칭호 AUTO / REVIEW 후보
- 대회 아카이브 자동 연결 강화

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
1. GitHub SEED ↔ 운영 Supabase 세부 diff 마무리
2. Team Builder canonical Team Snapshot v1 규격 확정 — IV 제외, Tera Type 추후 Regulation 확인 후 확장
3. Replica Team ID → Team Snapshot 매핑 가능성 검증
4. Records 시즌 3 운영 전 최종 회귀 테스트
5. Season / Event / Entry / Match / Result / RankingAward schema 확정
6. 테스트 환경에서 정규화 migration 검증
```

현재는 **Replica Team ID Import 전체 UI 구현보다 Team Snapshot 계약을 먼저 확정하는 것**이 중요합니다. 이 계약이 확정되면 DB 정규화를 진행하고, Import UI와 대회 제출 기능은 동일한 Snapshot 구조 위에 구현합니다.
