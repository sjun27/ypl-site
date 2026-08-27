import React, { useMemo, useState } from "react";
import { Reveal, StandTable } from "../components/index.js";
import { buildRecordsSnapshot } from "../services/recordsAnalytics.js";
import { syncTournamentRounds } from "../services/recordSync.js";
import "../records.css";

const uid = () => Math.random().toString(36).slice(2, 9);

const placementLabel = (p, team = false) => {
  if (p === "win") return team ? "팀 우승" : "우승";
  if (p === "ru") return team ? "팀 준우승" : "준우승";
  if (p === "sf") return team ? "팀 4강" : "4강";
  return "참가";
};

const pct = (value) => (value == null ? "—" : `${value.toFixed(1)}%`);

/* ============================== RECORDS ============================== */
export default function RecordsPage({ data, admin, setModal, save }) {
  const [tab, setTab] = useState("trainer");
  const snapshot = useMemo(() => buildRecordsSnapshot(data), [data]);

  return (
    <section className="sec">
      <Reveal className="sec-head">
        <div className="kick">Records &amp; Stats</div>
        <h2>기록</h2>
        <p className="sub">YPL의 대회 성적과 저장된 대진표를 바탕으로 트레이너·대회·포켓몬 기록을 한곳에 정리합니다.</p>
      </Reveal>

      <Reveal className="subtabs records-main-tabs">
        {[
          ["trainer", "트레이너"],
          ["tour", "대회"],
          ["pokemon", "포켓몬"],
          ["rank", "랭킹"],
        ].map(([key, label]) => (
          <button key={key} className={"subtab" + (tab === key ? " on" : "")} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </Reveal>

      <CoverageNote snapshot={snapshot} />

      <div className="swap" key={tab}>
        {tab === "trainer" && <TrainerView snapshot={snapshot} />}
        {tab === "tour" && <TournamentArchiveView snapshot={snapshot} data={data} admin={admin} setModal={setModal} />}
        {tab === "pokemon" && <PokemonView snapshot={snapshot} />}
        {tab === "rank" && <RankingHub data={data} admin={admin} setModal={setModal} save={save} />}
      </div>
    </section>
  );
}

function CoverageNote({ snapshot }) {
  const { coverage } = snapshot;
  return (
    <Reveal className="records-coverage">
      <div>
        <b>현재 저장 자료 기준</b>
        <span>
          경기 전적은 <strong>YPL 시즌 3부터 기록에 반영된 개인전 대진표</strong>에서 실제 상대가 있었던 경기만 집계합니다.
          이전 시즌의 승·패는 소급 추정하지 않습니다.
        </span>
      </div>
      <div className="records-coverage-stats">
        <span>연결 대진표 <b>{coverage.appliedBrackets}</b></span>
        <span>집계 경기 <b>{coverage.officialMatches}</b></span>
        <span>저장 엔트리 <b>{coverage.savedRosters}</b></span>
      </div>
    </Reveal>
  );
}

/* ============================== TRAINERS ============================== */
function officialWLSeason(name) {
  if (!name) return true;
  const match = String(name).match(/YPL\s*시즌\s*(\d+)/i);
  return !!match && Number(match[1]) >= 3;
}

function TrainerView({ snapshot }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(snapshot.trainers[0]?.name || "");
  const [season, setSeason] = useState("");

  const visible = snapshot.trainers.filter((t) => t.name.includes(query.trim()));
  const currentName = snapshot.profiles[selected] ? selected : visible[0]?.name || snapshot.trainers[0]?.name;
  const profile = currentName ? snapshot.profiles[currentName] : null;

  if (!profile) return <div className="panel none records-empty">트레이너 기록이 없습니다.</div>;

  const seasonMatch = (value) => !season || value === season;
  const placements = profile.placements.filter((p) => seasonMatch(p.season));
  const matches = profile.matches.filter((m) => seasonMatch(m.season));
  const participations = profile.participations.filter((p) => seasonMatch(p.season));
  const rosters = profile.rosters.filter((r) => seasonMatch(r.season));

  const individualPlacements = placements.filter((p) => !p.team);
  const championships = individualPlacements.filter((p) => p.placement === "win").length;
  const runnerUps = individualPlacements.filter((p) => p.placement === "ru").length;
  const top4 = individualPlacements.filter((p) => p.placement === "sf").length;
  const wins = matches.filter((m) => m.won).length;
  const losses = matches.length - wins;
  const winRate = matches.length ? (wins / matches.length) * 100 : null;
  const wlTracked = officialWLSeason(season);

  const rivalMap = new Map();
  for (const match of matches) {
    const cur = rivalMap.get(match.opponent) || { name: match.opponent, games: 0, wins: 0, losses: 0 };
    cur.games += 1;
    if (match.won) cur.wins += 1;
    else cur.losses += 1;
    rivalMap.set(match.opponent, cur);
  }
  const rival = [...rivalMap.values()].sort((a, b) => b.games - a.games)[0] || null;

  const favoriteMap = new Map();
  for (const roster of rosters) {
    for (const pokemon of new Set(roster.pokemon || [])) {
      favoriteMap.set(pokemon, (favoriteMap.get(pokemon) || 0) + 1);
    }
  }
  const favorites = [...favoriteMap.entries()]
    .map(([name, entries]) => ({ name, entries }))
    .sort((a, b) => b.entries - a.entries || a.name.localeCompare(b.name, "ko"));

  return (
    <div className="records-trainer-layout">
      <aside className="panel records-trainer-list">
        <div className="records-search">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="트레이너 검색" />
          <span>{visible.length}명</span>
        </div>
        <div className="records-trainer-scroll">
          {visible.map((trainer) => (
            <button
              key={trainer.name}
              className={"records-trainer-row" + (trainer.name === currentName ? " on" : "")}
              onClick={() => setSelected(trainer.name)}
            >
              <b>{trainer.name}</b>
              <span>우승 {trainer.wins} · 공식 경기 {trainer.matches}</span>
            </button>
          ))}
          {!visible.length && <div className="none records-list-none">검색 결과 없음</div>}
        </div>
      </aside>

      <div className="records-profile">
        <div className="panel records-profile-hero">
          <div className="records-profile-head">
            <div>
              <span className="records-eyebrow">YPL TRAINER</span>
              <h3>{profile.name}</h3>
            </div>
            <select value={season} onChange={(e) => setSeason(e.target.value)} aria-label="시즌 필터">
              <option value="">전체 기록</option>
              {snapshot.seasons.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          <div className="records-stat-grid">
            <Stat label="확인 가능한 참가" value={participations.length} suffix="회" />
            <Stat label="우승" value={championships} suffix="회" />
            <Stat label="준우승" value={runnerUps} suffix="회" />
            <Stat label="4강" value={top4} suffix="회" />
          </div>

          <div className="records-match-summary">
            {wlTracked ? (
              <div>
                <span>공식 경기 전적</span>
                <b>{wins}승 {losses}패</b>
                <em>{pct(winRate)}</em>
              </div>
            ) : (
              <div>
                <span>공식 경기 전적</span>
                <b>미집계</b>
              </div>
            )}
            <p>
              {wlTracked
                ? "YPL 시즌 3부터 기록에 반영된 개인전 대진표의 실제 경기만 집계합니다. 부전승은 경기 수와 승리에 포함하지 않으며, 팀전 개인경기는 집계 기준 확정 전까지 제외합니다."
                : "YPL 시즌 1~2 및 그 이전 기록은 대회 성적만 보존하며, 경기별 승·패는 소급 집계하지 않습니다."}
            </p>
          </div>
        </div>

        <div className="records-profile-grid">
          <section className="panel records-block">
            <div className="records-block-head">
              <h4>대회 이력</h4>
              <span>{placements.length}건의 입상 기록</span>
            </div>
            <div className="records-history">
              {placements
                .slice()
                .sort((a, b) => (a.date < b.date ? 1 : -1))
                .slice(0, 12)
                .map((event) => (
                  <div className="records-history-row" key={`${event.id}:${event.name}:${event.placement}`}>
                    <div>
                      <b>{event.tournamentName}{event.round ? ` ${event.round}회` : ""}</b>
                      <span>{[event.date, event.season, event.rule].filter(Boolean).join(" · ")}</span>
                    </div>
                    <strong className={"records-placement p-" + event.placement}>
                      {placementLabel(event.placement, event.team)}
                    </strong>
                  </div>
                ))}
              {!placements.length && <div className="none">현재 확인 가능한 입상 기록이 없습니다.</div>}
            </div>
          </section>

          <section className="panel records-block">
            <div className="records-block-head">
              <h4>엔트리 기록</h4>
              <span>저장된 파티 기준</span>
            </div>
            {favorites.length ? (
              <div className="records-favorites">
                {favorites.slice(0, 6).map((item, index) => (
                  <div key={item.name}>
                    <span className="tnum">{String(index + 1).padStart(2, "0")}</span>
                    <b>{item.name}</b>
                    <em>{item.entries}회</em>
                  </div>
                ))}
              </div>
            ) : (
              <div className="none">저장된 엔트리가 없습니다.</div>
            )}

            {wlTracked && rival && (
              <div className="records-rival">
                <span>가장 많이 만난 상대</span>
                <b>{rival.name}</b>
                <em>{rival.games}경기 · {rival.wins}승 {rival.losses}패</em>
              </div>
            )}
          </section>
        </div>

        {(profile.champions.length > 0 || profile.titles.length > 0) && (
          <div className="records-profile-grid">
            {profile.champions.length > 0 && (
              <section className="panel records-block">
                <div className="records-block-head"><h4>명예의 전당</h4></div>
                <div className="records-achievements">
                  {profile.champions.map((c, i) => (
                    <div key={`${c.gen}:${i}`}>
                      <strong>👑 {c.gen} 챔피언</strong>
                      <span>{c.season}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {profile.titles.length > 0 && (
              <section className="panel records-block">
                <div className="records-block-head"><h4>칭호</h4></div>
                <div className="records-title-chips">
                  {profile.titles.map((title, i) => (
                    <span key={`${title.name}:${i}`}>{title.icon} {title.name}</span>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, suffix }) {
  return (
    <div className="records-stat">
      <span>{label}</span>
      <b>{value}<small>{suffix}</small></b>
    </div>
  );
}

/* ============================== TOURNAMENT ARCHIVE ============================== */
function NameChips({ list, kind }) {
  return <>{(list || []).map((n, i) => <span key={i} className={"r2-name " + (kind || "")}>{n}</span>)}</>;
}

function TournamentArchiveView({ data, admin, setModal }) {
  const tours = data.tournaments || [];
  const rank = (t) => {
    const label = t.label || "";
    return label.includes("마스터") ? 0 : label.includes("루키") ? 1 : label.includes("라이트") ? 2 : label.includes("클래식") ? 3 : 4;
  };
  const otours = [...tours].sort((a, b) => rank(a) - rank(b));
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const selectedTour = category === "all" ? null : tours.find((x) => x.key === category) || otours[0];
  const split = (value) => String(value || "").split("/").map((x) => x.trim()).filter(Boolean);

  const sortRounds = (rounds) => [...(rounds || [])].sort((a, b) => {
    if ((a.date || "") !== (b.date || "")) return (a.date || "") < (b.date || "") ? 1 : -1;
    const ca = a.champ ? 1 : 0;
    const cb = b.champ ? 1 : 0;
    if (ca !== cb) return cb - ca;
    return (parseInt(b.round) || 0) - (parseInt(a.round) || 0);
  });

  const roundMatches = (tour, round) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return [
      tour.label,
      round.date,
      round.round,
      round.season,
      round.rule,
      round.win,
      round.ru,
      ...(round.winMembers || []),
      ...(round.ruMembers || []),
      ...(round.sf || []),
      ...((round.sfMembers || []).flat ? (round.sfMembers || []).flat() : []),
    ].join(" ").toLowerCase().includes(normalized);
  };

  const openRoundEditor = () => {
    if (!selectedTour) return;
    setModal({
      type: "rounds",
      title: selectedTour.label,
      rounds: selectedTour.rounds,
      seasons: (data.seasons || []).map((season) => season.name),
      build: (rounds) => syncTournamentRounds(data, selectedTour.key, rounds),
    });
  };

  const renderRound = (tour, r, key, showCompetition = false) => {
    const rl = r.round ? (/^\d+$/.test(String(r.round)) ? String(r.round) + "회" : r.round) : "";
    return (
      <div className={"round2" + (r.champ ? " champ" : "")} key={key}>
        <div className="r2-date tnum">{r.date}</div>
        <div className="r2-main">
          {(showCompetition || rl || r.rule || r.team || r.champ || r.season) && <div className="r2-head">
            {showCompetition && <span className="r2-rule">{tour.label}</span>}
            {rl && <span className="r2-round">{rl}</span>}
            {r.season && <span className="r2-season">{r.season}</span>}
            {r.champ && <span className="r2-champ">챔피언스 시리즈</span>}
            {r.team && <span className="r2-mode">팀전</span>}
            {r.rule && <span className="r2-rule">{r.rule}</span>}
          </div>}
          <div className="r2-res">
            <span className="r2-rk gold">우승</span>
            {r.win && <span className="r2-name win">{r.win}</span>}
            {r.winMembers && r.winMembers.length > 0 && <NameChips list={r.winMembers} kind="mem" />}
            {(r.ru || (r.ruMembers && r.ruMembers.length > 0)) && <>
              <span className="r2-rk">준우승</span>
              {r.team ? (r.ru && <span className="r2-name">{r.ru}</span>) : <NameChips list={split(r.ru)} />}
              {r.ruMembers && r.ruMembers.length > 0 && <NameChips list={r.ruMembers} kind="mem" />}
            </>}
            {(r.sf || []).length > 0 && <>
              <span className="r2-rk">4강</span>
              {r.team
                ? r.sf.map((nm, k) => (
                    <React.Fragment key={k}>
                      {nm && <span className="r2-name">{nm}</span>}
                      {(r.sfMembers || [])[k] && r.sfMembers[k].length > 0 && <NameChips list={r.sfMembers[k]} kind="mem" />}
                    </React.Fragment>
                  ))
                : <NameChips list={r.sf} />}
            </>}
          </div>
        </div>
      </div>
    );
  };

  const allRows = otours.flatMap((tour) =>
    sortRounds(tour.rounds)
      .filter((round) => roundMatches(tour, round))
      .map((round, index) => ({ tour, round, key: `${tour.key}:${round.id || index}` }))
  ).sort((a, b) => {
    if ((a.round.date || "") !== (b.round.date || "")) return (a.round.date || "") < (b.round.date || "") ? 1 : -1;
    return (parseInt(b.round.round) || 0) - (parseInt(a.round.round) || 0);
  });

  if (!otours.length) return <div className="panel none" style={{ padding: 24 }}>데이터 없음</div>;

  return (<>
    <div className="subtabs">
      <button className={"subtab" + (category === "all" ? " on" : "")} onClick={() => setCategory("all")}>전체</button>
      {otours.map((tour) => (
        <button key={tour.key} className={"subtab" + (category === tour.key ? " on" : "")} onClick={() => setCategory(tour.key)}>{tour.label}</button>
      ))}
    </div>

    {selectedTour ? (
      <div className="panel swap" key={category} style={{ paddingBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 2px 4px", flexWrap: "wrap" }}>
          <span style={{ width: 11, height: 11, borderRadius: 4, background: selectedTour.color }} />
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--navy)" }}>{selectedTour.label}</h3>
          <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 600 }} className="tnum">{(selectedTour.rounds || []).length}회</span>
          {admin && <button className="btn btn-gold btn-sm ed-pencil" onClick={openRoundEditor}>회차 편집</button>}
        </div>
        {sortRounds(selectedTour.rounds).map((r, i) => renderRound(selectedTour, r, r.id || i, false))}
      </div>
    ) : (
      <>
        <div className="records-toolbar">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="대회명, 시즌, 룰, 입상자 검색" />
          <span>전체 {allRows.length}회차</span>
        </div>
        <div className="panel swap" style={{ paddingBottom: 14 }}>
          {allRows.map(({ tour, round, key }) => renderRound(tour, round, key, true))}
          {!allRows.length && <div className="none" style={{ padding: 24 }}>표시할 대회 기록이 없습니다.</div>}
        </div>
      </>
    )}
  </>);
}

/* ============================== POKEMON ============================== */
function PokemonView({ snapshot }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(snapshot.pokemon[0]?.name || "");
  const normalized = query.trim().toLowerCase();

  const visible = snapshot.pokemon.filter((p) => p.name.toLowerCase().includes(normalized));
  const currentName = snapshot.pokemon.some((p) => p.name === selected) ? selected : visible[0]?.name || snapshot.pokemon[0]?.name;
  const current = snapshot.pokemon.find((p) => p.name === currentName);

  if (!current) {
    return (
      <div className="panel none records-empty">
        현재 기록에 연결된 파티 엔트리가 없습니다. 대진표의 파티 엔트리가 저장되면 자동으로 집계됩니다.
      </div>
    );
  }

  return (
    <div className="records-pokemon-layout">
      <aside className="panel records-pokemon-list">
        <div className="records-search">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="포켓몬 검색" />
          <span>{visible.length}종</span>
        </div>
        <div className="records-pokemon-scroll">
          {visible.map((pokemon, index) => (
            <button
              key={pokemon.name}
              className={"records-pokemon-row" + (pokemon.name === currentName ? " on" : "")}
              onClick={() => setSelected(pokemon.name)}
            >
              <span className="tnum">{index + 1}</span>
              <b>{pokemon.name}</b>
              <em>{pokemon.entries}회</em>
            </button>
          ))}
        </div>
      </aside>

      <div className="records-profile">
        <section className="panel records-profile-hero">
          <span className="records-eyebrow">YPL ENTRY RECORD</span>
          <h3>{current.name}</h3>
          <div className="records-stat-grid pokemon">
            <Stat label="등록 엔트리" value={current.entries} suffix="회" />
            <Stat label="엔트리 채용률" value={current.entryRate.toFixed(1)} suffix="%" />
            <Stat label="사용 트레이너" value={current.trainerCount} suffix="명" />
            <Stat label="우승 엔트리" value={current.wins} suffix="회" />
          </div>
          <p className="records-pokemon-note">
            채용률은 현재 저장된 파티 엔트리 {snapshot.rosters.length}개를 기준으로 계산합니다.
            실제 경기 선출 여부는 기록하지 않으므로 포켓몬 승률은 표시하지 않습니다.
          </p>
        </section>

        <div className="records-profile-grid">
          <section className="panel records-block">
            <div className="records-block-head"><h4>많이 등록한 트레이너</h4></div>
            <div className="records-favorites">
              {current.trainers.slice(0, 8).map((item, index) => (
                <div key={item.name}>
                  <span className="tnum">{String(index + 1).padStart(2, "0")}</span>
                  <b>{item.name}</b>
                  <em>{item.entries}회</em>
                </div>
              ))}
            </div>
          </section>

          <section className="panel records-block">
            <div className="records-block-head"><h4>함께 많이 등록된 포켓몬</h4></div>
            <div className="records-favorites">
              {current.partners.slice(0, 8).map((item, index) => (
                <div key={item.name}>
                  <span className="tnum">{String(index + 1).padStart(2, "0")}</span>
                  <b>{item.name}</b>
                  <em>{item.entries}회</em>
                </div>
              ))}
              {!current.partners.length && <div className="none">동반 엔트리 기록이 없습니다.</div>}
            </div>
          </section>
        </div>

        {current.champions.length > 0 && (
          <section className="panel records-block">
            <div className="records-block-head">
              <h4>역대 챔피언 엔트리</h4>
              <span>명예의 전당 데이터</span>
            </div>
            <div className="records-achievements">
              {current.champions.map((item, index) => (
                <div key={`${item.gen}:${index}`}>
                  <strong>👑 {item.gen} · {item.name}</strong>
                  <span>{item.season}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/* ============================== RANKING HUB ============================== */
function RankingHub({ data, admin, setModal, save }) {
  const [sub, setSub] = useState("rank");
  return (
    <>
      <div className="subtabs records-rank-tabs">
        <button className={"subtab" + (sub === "rank" ? " on" : "")} onClick={() => setSub("rank")}>누적 랭킹</button>
        <button className={"subtab" + (sub === "season" ? " on" : "")} onClick={() => setSub("season")}>시즌별 성적</button>
      </div>
      <p className="pts-note records-points-note">
        우승 <b>60</b>점, 준우승 <b>40</b>점, 4강 <b>20</b>점이 기본 포인트 기준입니다.
        팀전 여부, 팀원 수, 대회 사정에 따라 변동될 수 있습니다.
      </p>
      {sub === "rank" ? (
        <RankView data={data} admin={admin} setModal={setModal} save={save} />
      ) : (
        <SeasonView data={data} admin={admin} setModal={setModal} save={save} />
      )}
    </>
  );
}

function RankView({ data, admin, setModal, save }) {
  const eras = data.rankings || [];
  const [sel, setSel] = useState(eras[0]?.key);
  const era = eras.find((e) => e.key === sel) || eras[0];
  const addEra = () => {
    const name = (prompt("새 누적 랭킹 탭 이름 (예: 클래식)") || "").trim();
    if (!name) return;
    const key = "r_" + uid();
    save({ ...data, rankings: [...eras, { key, label: name, rows: [] }] });
    setSel(key);
  };

  if (!era) {
    return (
      <>
        {admin && <div style={{ padding: "4px 0" }}><button className="btn btn-gold btn-sm" onClick={addEra}>+ 랭킹 탭 추가</button></div>}
        <div className="panel none" style={{ padding: 24 }}>데이터 없음</div>
      </>
    );
  }

  return (
    <>
      <div className="subtabs">
        {eras.map((e) => (
          <button key={e.key} className={"subtab" + (e.key === sel ? " on" : "")} onClick={() => setSel(e.key)}>{e.label}</button>
        ))}
        {admin && <button className="subtab add" onClick={addEra}>+ 추가</button>}
      </div>
      <div className="panel swap" key={sel}>
        {admin && (
          <div style={{ padding: "12px 0 2px" }}>
            <button
              className="btn btn-gold btn-sm"
              onClick={() => setModal({
                type: "standings",
                title: era.label + " 랭킹",
                rows: era.rows,
                build: (rows) => ({ ...data, rankings: eras.map((x) => x.key === era.key ? { ...x, rows } : x) }),
              })}
            >
              이 시기 랭킹 수정
            </button>
          </div>
        )}
        <StandTable rows={era.rows} />
      </div>
    </>
  );
}

function SeasonView({ data, admin, setModal, save }) {
  const seasons = data.seasons || [];
  const [sel, setSel] = useState(Math.max(0, seasons.length - 1));
  const addSeason = () => {
    const name = (prompt("새 시즌 이름 (예: YPL 시즌 3)") || "").trim();
    if (!name) return;
    save({ ...data, seasons: [...seasons, { name, rows: [] }] });
    setSel(seasons.length);
  };
  const s = seasons[sel];

  if (!s) {
    return (
      <>
        {admin && <div style={{ padding: "4px 0" }}><button className="btn btn-gold btn-sm" onClick={addSeason}>+ 시즌 추가</button></div>}
        <div className="panel none" style={{ padding: 24 }}>데이터 없음</div>
      </>
    );
  }

  const hasNote = s.rows.some((r) => r.note);
  const ordered = [...seasons.map((x, i) => ({ x, i }))].reverse();

  return (
    <>
      <div className="subtabs">
        {ordered.map(({ x, i }) => (
          <button key={i} className={"subtab" + (i === sel ? " on" : "")} onClick={() => setSel(i)}>{x.name}</button>
        ))}
        {admin && <button className="subtab add" onClick={addSeason}>+ 추가</button>}
      </div>
      <div className="panel swap" key={sel}>
        {admin && (
          <div style={{ padding: "12px 0 2px" }}>
            <button
              className="btn btn-gold btn-sm"
              onClick={() => setModal({
                type: "standings",
                title: s.name,
                rows: s.rows,
                build: (rows) => ({ ...data, seasons: seasons.map((x, i) => i === sel ? { ...x, rows } : x) }),
              })}
            >
              {s.name} 성적 수정
            </button>
          </div>
        )}
        <StandTable rows={s.rows} showNote={hasNote} />
      </div>
    </>
  );
}
