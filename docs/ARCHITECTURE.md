# YPL 기술 구조 및 데이터 아키텍처

> 이 문서는 YPL 사이트의 **현재 기술 구조, 데이터 원본, 테스트 안전수칙, Records 데이터 모델 및 향후 migration 원칙**을 관리합니다.
>
> 현재 할 일과 우선순위는 `docs/ROADMAP.md`, 실제 변경 이력은 `docs/PATCH_NOTES_2026-08-26.md`를 봅니다.

마지막 업데이트: 2026-08-29

---

# 1. 시스템 구성

```text
GitHub / GitHub Pages
= 애플리케이션 코드 + SEED

Supabase
= 실제 공유 운영 데이터

Browser localStorage
= Team Builder 개인 저장 데이터
```

## 1.1 애플리케이션 구조

현재 주요 코드 책임은 다음과 같이 분리되어 있습니다.

```text
src/
├─ pages/        화면
├─ components/   공통 UI / layout
├─ admin/        관리자 UI
├─ services/     데이터·도메인 로직
├─ data/         정적 데이터
├─ storage.js    저장 위치 선택
└─ App.jsx       전체 조합
```

화면이 Supabase 구현을 직접 다루지 않고 서비스 / storage 계층을 통해 접근하는 구조를 유지합니다.

---

# 2. 운영 데이터 원본

현재 운영 데이터의 기준 원본은 다음입니다.

```text
Supabase
table: site_data
key: ypl_data_v4
```

GitHub 코드의 SEED는 fallback 및 개발용 기본 데이터이며 자동 백업본이 아닙니다.

따라서:

```text
운영 데이터 판단
Supabase > GitHub SEED
```

를 원칙으로 합니다.

## 2.1 현재 legacy 구조

`ypl_data_v4` 한 JSON 안에 여러 운영 데이터가 함께 존재합니다.

대표 영역:

```text
tournaments
brackets
rankings
seasons
champions
titleGroups
news / board / 기타 운영 데이터
```

현재 Records 1차 버전은 새 테이블을 만들지 않고 이 데이터를 읽어 파생 기록을 계산합니다.

---

# 3. 실행 환경과 테스트 안전수칙

## 3.1 Production

공식 GitHub Pages는 운영 Supabase를 사용합니다.

## 3.2 Beta Pages

개인 GitHub Pages production build도 운영 Supabase를 바라볼 수 있으므로 **조회 / UI 확인 전용**으로 취급합니다.

하지 않는 작업:

- 관리자 저장
- 공지 수정
- 대진표 기록 반영
- 칭호 / 명예의 전당 수정
- 기타 공유 운영 데이터 write

## 3.3 Local development

일반 Vite dev는 `.env.production`을 자동으로 읽지 않으므로 로컬 SEED 또는 localStorage 경로를 사용할 수 있습니다.

운영 Supabase 실제 데이터를 읽어 확인해야 할 때는 production build / preview를 사용하되 **read-only 검증**을 원칙으로 합니다.

---

# 4. Team Builder 저장 구조

현재 Team Builder의 개인 팀은 운영 `ypl_data_v4`와 분리합니다.

```text
YPL 운영 데이터
→ Supabase

Team Builder 개인 팀
→ Browser localStorage
```

기존 저장 키 호환성을 유지합니다.

대회 엔트리 제출 기능을 추가할 때는 개인 작업본을 그대로 연결하지 않고 **제출 당시 Team Snapshot을 별도로 고정**합니다.

---

# 5. Records 데이터 원칙

## 5.1 원본 사실 우선

다음 계산 결과를 원본으로 저장하지 않습니다.

```text
A = 18승 11패
망나뇽 = 14회 사용
```

대신 다음 원본 사실을 보존합니다.

```text
Tournament
Entry
Match
Result
```

즉:

- 누가 참가했는가
- 어떤 엔트리를 제출했는가
- 누가 누구와 경기했는가
- 누가 이겼는가
- 어디까지 진출했는가

를 저장하고 통계는 여기서 계산합니다.

## 5.2 과거 데이터

없는 경기 기록을 추측하지 않습니다.

```text
full_match
= 전체 대진표가 있어 경기 단위 복원 가능

placement
= 입상 기록만 확인 가능

winner_only
= 우승자만 확인 가능

manual
= 별도 자료로 검증된 기록
```

## 5.3 Match 범위

YPL 시즌 3부터 기록에 반영된 대진표의 Match 원본을 사용합니다.

포함:

- 개인전
- 팀전 선발 경기
- 에이스 결정전
- 경기 단계
- 승자 / 패자
- 시즌 / 대회 구분

제외:

- BYE

팀전 Match에는 향후 개인전과 분리 집계할 수 있도록 팀전 문맥을 유지합니다.

## 5.4 공개와 저장의 분리

원본으로 저장했다고 모든 파생 통계를 공개하지는 않습니다.

기본 미공개:

- 개인 승 / 패
- 승률
- Rival / Head-to-Head
- 연승

기본 공개:

- 참가
- 우승 / 준우승 / 4강
- 전체 대회 이력
- 엔트리
- 칭호
- 명예의 전당

---

# 6. 대진표 → Records 연결

현재 legacy JSON 단계에서는 대진표 graph를 Match 원본으로 봅니다.

```text
대진표 결과 입력
→ 기록에 반영
→ 대회 회차 생성
→ 랭킹 / 시즌 성적 반영
→ recordMeta 연결
→ Records 계산
```

반영이 완료된 대진표는 잠급니다.

수정 절차:

```text
반영 취소
→ 연결 기록 원복
→ 대진표 수정
→ 다시 기록 반영
```

대진표에서 생성된 회차를 직접 수정할 경우 graph와 결과가 달라질 수 있으므로 장기적으로 직접 편집 제한을 검토합니다.

---

# 7. 최종 성적 파생 규칙

## 싱글 엘리미네이션

```text
우승
준우승
4강
8강
16강
...
```

실제 탈락 라운드 기준으로 계산합니다.

BYE는 한 라운드를 이긴 것으로 보지 않습니다.

## 더블 엘리미네이션

두 번째 패배로 탈락한 시점을 기준으로 최종 순위를 계산합니다.

예:

```text
우승
준우승
3위
4위
공동 5위
공동 7위
```

같은 elimination batch에서 탈락하면 공동 순위가 될 수 있습니다.

Grand Final Reset 구조를 고려합니다.

## 조별리그 + 본선

본선 진출자는 본선 결과를 사용합니다.

비진출자는 현재:

```text
조별리그 탈락
```

으로 기록합니다.

현 조별리그 코드의 동률 처리 기준이 충분히 구조화되기 전에는 정확한 `조 3위` 같은 표시는 만들지 않습니다.

## 팀전

팀의 최종 성적을 각 팀원 기록에 연결합니다.

예:

```text
팀 우승
팀 준우승
팀 4강
팀 8강
```

팀전 입상은 해당 트레이너의 통산 우승·준우승·4강 집계에도 포함합니다.

---

# 8. 챔피언스 시리즈

챔피언스 시리즈 회차 번호는 별도 계산하지 않습니다.

source of truth:

```text
tournaments[].rounds[].round
```

`champ = true`는 해당 회차가 Champions라는 사실만 의미합니다.

```text
round = 8
champ = true
→ 챔피언스 시리즈 8회
```

---

# 9. 포켓몬 기록

현재 포켓몬 기록은 **엔트리 등록 기준**입니다.

가능한 지표:

- 엔트리 등록 횟수
- 채용률
- 사용 트레이너 수
- 우승 엔트리 포함
- 준우승 엔트리 포함
- 4강 엔트리 포함
- 같이 등록된 포켓몬

현재 만들지 않는 지표:

```text
포켓몬 경기 승률
```

이유는 실제 경기별 선출 포켓몬을 기록하지 않기 때문입니다.

---

# 10. 목표 데이터 모델

운영 데이터 조사 후 다음 객체로 정규화하는 것을 목표로 합니다.

## Player

트레이너 고유 식별자.

이름 문자열만 연결 키로 쓰지 않고 장기적으로 `player_id`를 사용합니다.

## Season

시즌 정보.

## Tournament

예:

- 대회명
- 시즌
- 날짜
- 포맷
- Rookie / Master / Light / Champions
- Regulation
- 특수 룰
- 팀전 여부
- 공식 W/L 포함 정책

## Entry

한 Player의 한 Tournament 참가 기록.

## Team Snapshot / Entry Pokémon

제출 당시 엔트리 고정본.

## Match

실제 경기 사실.

예:

- tournament_id
- stage
- entry_a / entry_b
- winner
- team context
- ace 여부

## Title Award

칭호 획득 이력.

AUTO / REVIEW / MANUAL 구분을 검토합니다.

---

# 11. Migration 원칙

현재 `ypl_data_v4`를 한 번에 제거하지 않습니다.

권장 전환:

```text
1. 운영 JSON 원본 백업
2. 현재 데이터 인벤토리 작성
3. 새 schema 설계
4. 테스트 환경 구축
5. legacy JSON → 새 구조 변환 검증
6. 읽기 경로부터 병행
7. write 경로 점진적 전환
8. 충분히 검증된 뒤 legacy 의존 축소
```

## 절대 먼저 하지 않는 것

- 백업 없이 운영 테이블 수정
- 운영 JSON을 새 SEED로 덮어쓰기
- 과거 기록 자동 추정
- schema 확정 전 대규모 migration
- 운영 페이지에서 직접 write 테스트

---

# 12. Supabase 접근권한 확보 후 점검 순서

2026-08-29 기준 Supabase 프로젝트 접근권한을 확보했습니다.

다음 순서로 **읽기와 백업부터** 진행합니다.

```text
1. 프로젝트 / 테이블 목록 확인
2. site_data 구조 확인
3. ypl_data_v4 원본 export
4. 별도 백업 파일 보관
5. RLS 정책 확인
6. Auth 사용 여부 확인
7. anon / authenticated 권한 확인
8. 실제 데이터 인벤토리 작성
9. SEED와 diff
10. 이후 schema 설계
```

보안 구조는 실측 전 추측하지 않습니다.

현재 프론트엔드에 클라이언트 관리자 UI가 존재하므로 Supabase RLS/Auth와 실제 write 권한이 어떤 상태인지 우선 확인해야 합니다.

---

# 13. 보안 방향

장기 목표:

```text
UI에서 관리자라고 표시됨
≠ 데이터 write 권한 보유
```

실제 write 권한은 Supabase Auth / RLS 같은 서버 측 정책으로 통제하는 구조가 목표입니다.

확인해야 할 항목:

- `site_data` SELECT 정책
- INSERT / UPDATE / DELETE 정책
- anon key로 가능한 범위
- authenticated 사용 여부
- 관리자 역할 표현 방식
- 게시판 PIN / 신청 응답 등 민감 데이터 노출 범위

실제 정책 변경은 운영 데이터 백업과 현재 정책 검토 후 진행합니다.

---

# 14. 문서 역할

```text
ROADMAP.md
→ 지금 어디까지 왔고 다음에 무엇을 할지

ARCHITECTURE.md
→ 기술 구조와 데이터 원칙

PATCH_NOTES_2026-08-26.md
→ 실제로 무엇을 언제 변경했는지
```

ROADMAP에는 과거 구현 과정을 길게 누적하지 않습니다.

PATCH_NOTES는 과거 상태가 현재 정책과 다르더라도 **변경 이력**으로 유지합니다.
