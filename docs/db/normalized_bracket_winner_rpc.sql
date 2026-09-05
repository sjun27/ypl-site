-- YPL normalized individual Single Elimination winner mutation RPC draft
-- Status: DRAFT / DO NOT RUN ON PRODUCTION
--
-- This file is intentionally separate from the create/delete RPC draft. It is
-- one atomic normalized transaction: no legacy bracket reads, sync writes, or
-- compensation path are involved.
--
-- Canonical inputs are bracket_entry_slots plus normalized Match winner facts.
-- BYE and future nodes are projection facts. Only a node with two resolved
-- Entry participants has a Match row and can be mutated.

create or replace function ypl_schema_validation.set_normalized_single_bracket_winner(
    p_runtime_id uuid,
    p_event_id uuid,
    p_source_node_key text,
    p_winner_entry_id uuid
)
returns table (
    runtime_id uuid,
    event_id uuid,
    source_node_key text,
    previous_winner_entry_id uuid,
    winner_entry_id uuid,
    deleted_downstream_count integer,
    created_downstream_count integer,
    changed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_event ypl_schema_validation.events%rowtype;
    v_runtime ypl_schema_validation.bracket_runtimes%rowtype;
    v_target_match ypl_schema_validation.matches%rowtype;
    v_lock record;
    v_node record;
    v_entry_count integer;
    v_bracket_size integer := 1;
    v_max_round integer := 0;
    v_target_round integer;
    v_target_match_no integer;
    v_round_match_count integer;
    v_round integer;
    v_match_no integer;
    v_desc_round integer;
    v_desc_match_no integer;
    v_entry_a uuid;
    v_entry_b uuid;
    v_winner uuid;
    v_existing_winner uuid;
    v_match_id uuid;
    v_match_found boolean;
    v_formed boolean;
    v_repair_only boolean := false;
    v_deleted_downstream integer := 0;
    v_created_downstream integer := 0;
    v_deleted integer := 0;
    v_sequence_no integer;
    v_node_key text;
begin
    if p_runtime_id is null or p_event_id is null then
        raise exception using errcode = 'P0001', message = 'runtime_id와 event_id가 필요합니다.';
    end if;
    if p_source_node_key is null
       or p_source_node_key !~ '^single:r[1-9][0-9]*:m[1-9][0-9]*$' then
        raise exception using errcode = 'P0001', message = 'Single bracket target node key가 올바르지 않습니다.';
    end if;

    -- Serialize every mutation for this Event before reading any canonical
    -- fact. A missing/foreign runtime is never interpreted as legacy state.
    select *
      into v_event
      from ypl_schema_validation.events
     where id = p_event_id
     for update;
    if not found then
        raise exception using errcode = 'P0001', message = 'winner mutation 대상 Event를 찾을 수 없습니다.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('normalized-single-runtime:' || p_runtime_id::text, 0));
    select *
      into v_runtime
      from ypl_schema_validation.bracket_runtimes as br
     where br.id = p_runtime_id
       and br.event_id = p_event_id
     ;
    if not found then
        raise exception using errcode = 'P0001', message = 'normalized Single runtime을 찾을 수 없습니다.';
    end if;
    if v_event.is_team_event
       or v_event.competition_format <> 'single_elimination'
       or v_event.status <> 'running'
       or v_event.record_applied_at is not null
       or v_runtime.topology_kind <> 'single_elimination'
       or v_runtime.projection_version <> 1 then
        raise exception using errcode = 'P0001', message = 'running 상태의 normalized Single runtime만 winner mutation할 수 있습니다.';
    end if;

    -- Lock all Match rows owned by this Event. Foreign-source rows are a hard
    -- boundary: this RPC must never silently absorb a legacy or other runtime.
    for v_lock in
        select m.id
          from ypl_schema_validation.matches as m
         where m.event_id = p_event_id
         for update
    loop
        null;
    end loop;
    if exists (
        select 1
          from ypl_schema_validation.matches as m
         where m.event_id = p_event_id
           and m.source <> 'normalized_bracket_runtime'
    ) then
        raise exception using errcode = 'P0001', message = 'Event에 foreign-source Match가 있어 winner mutation을 중단했습니다.';
    end if;
    if exists (select 1 from ypl_schema_validation.results as r0 where r0.event_id = p_event_id)
       or exists (select 1 from ypl_schema_validation.ranking_awards as a0 where a0.event_id = p_event_id) then
        raise exception using errcode = 'P0001', message = 'Result 또는 RankingAward가 있으면 winner mutation을 수행할 수 없습니다.';
    end if;

    -- Identity and slot facts are validated from the runtime-owned rows. No
    -- Entry.seed ordering or implicit fallback is allowed here.
    select count(*)::integer
      into v_entry_count
      from ypl_schema_validation.bracket_identity_changes as c
     where c.bracket_runtime_id = p_runtime_id
       and c.event_id = p_event_id;
    if v_entry_count < 2 then
        raise exception using errcode = 'P0001', message = 'normalized Single runtime 참가자가 2명 미만입니다.';
    end if;
    while v_bracket_size < v_entry_count loop
        v_bracket_size := v_bracket_size * 2;
    end loop;
    if (select count(distinct c.entry_id)::integer
          from ypl_schema_validation.bracket_identity_changes as c
         where c.bracket_runtime_id = p_runtime_id
           and c.event_id = p_event_id) <> v_entry_count then
        raise exception using errcode = 'P0001', message = 'runtime ownership에 duplicate Entry identity가 있습니다.';
    end if;
    while v_bracket_size > 1 loop
        v_max_round := v_max_round + 1;
        v_bracket_size := v_bracket_size / 2;
    end loop;
    -- Recompute the size after deriving max round.
    v_bracket_size := 1;
    while v_bracket_size < v_entry_count loop
        v_bracket_size := v_bracket_size * 2;
    end loop;

    if exists (
        select 1
          from ypl_schema_validation.bracket_identity_changes as c
          left join ypl_schema_validation.entries as e
            on e.id = c.entry_id and e.event_id = p_event_id
          left join ypl_schema_validation.entry_participants as ep
            on ep.id = c.entry_participant_id
           and ep.event_id = p_event_id
           and ep.entry_id = c.entry_id
           and ep.registration_id = c.registration_id
           and ep.player_id = c.player_id
          left join ypl_schema_validation.event_registrations as r
            on r.id = c.registration_id
           and r.event_id = p_event_id
           and r.player_id = c.player_id
          left join ypl_schema_validation.players as pl
            on pl.id = c.player_id
         where c.bracket_runtime_id = p_runtime_id
           and c.event_id = p_event_id
           and (e.id is null or e.entry_type <> 'individual' or e.status <> 'active'
                or ep.id is null or ep.member_order <> 1
                or r.id is null or pl.id is null)
    ) then
        raise exception using errcode = 'P0001', message = 'Entry/EntryParticipant canonical identity가 runtime과 일치하지 않습니다.';
    end if;
    if (select count(*)::integer
          from ypl_schema_validation.bracket_entry_slots as s
         where s.bracket_runtime_id = p_runtime_id
           and s.event_id = p_event_id) <> v_entry_count then
        raise exception using errcode = 'P0001', message = 'persisted slot set이 active Entry identity와 일치하지 않습니다.';
    end if;
    if exists (
        select 1
          from ypl_schema_validation.bracket_entry_slots as s
         where s.bracket_runtime_id = p_runtime_id
           and s.event_id = p_event_id
           and (s.stage_kind <> 'elimination' or s.stage_no <> 1 or s.pool_no <> 0
                or s.slot_no < 1 or s.slot_no > v_bracket_size)
    ) then
        raise exception using errcode = 'P0001', message = 'persisted Single slot topology가 malformed 상태입니다.';
    end if;
    if exists (
        select 1
          from ypl_schema_validation.bracket_entry_slots as s
          left join ypl_schema_validation.bracket_identity_changes as c
            on c.bracket_runtime_id = p_runtime_id
           and c.event_id = p_event_id
           and c.entry_id = s.entry_id
         where s.bracket_runtime_id = p_runtime_id
           and s.event_id = p_event_id
           and c.entry_id is null
    ) or exists (
        select 1
          from ypl_schema_validation.bracket_identity_changes as c
          left join ypl_schema_validation.bracket_entry_slots as s
            on s.bracket_runtime_id = p_runtime_id
           and s.event_id = p_event_id
           and s.entry_id = c.entry_id
         where c.bracket_runtime_id = p_runtime_id
           and c.event_id = p_event_id
           and s.entry_id is null
    ) then
        raise exception using errcode = 'P0001', message = 'slot의 Entry 집합이 runtime ownership과 일치하지 않습니다.';
    end if;
    if exists (
        with slots as (
            select s.slot_no, s.entry_id
              from ypl_schema_validation.bracket_entry_slots as s
             where s.bracket_runtime_id = p_runtime_id and s.event_id = p_event_id
        )
        select 1
          from generate_series(1, v_bracket_size / 2) as g(match_no)
          left join slots a on a.slot_no = (g.match_no * 2) - 1
          left join slots b on b.slot_no = g.match_no * 2
         where a.entry_id is null and b.entry_id is null
    ) then
        raise exception using errcode = 'P0001', message = 'persisted first-round slot에 double-BYE가 있습니다.';
    end if;

    -- Every normalized Match must belong to the generated Single key space;
    -- an extra or out-of-range row is malformed state, never a recoverable
    -- legacy fallback.
    if exists (
        select 1
          from ypl_schema_validation.matches as m
         where m.event_id = p_event_id
           and m.source = 'normalized_bracket_runtime'
           and (
               m.source_node_key is null
               or m.source_node_key !~ '^single:r[1-9][0-9]*:m[1-9][0-9]*$'
               or substring(m.source_node_key from '^single:r([0-9]+):m[0-9]+$')::integer > v_max_round
               or substring(m.source_node_key from 'm([0-9]+)$')::integer
                    > v_bracket_size / power(2, substring(m.source_node_key from '^single:r([0-9]+):m[0-9]+$')::integer)::integer
           )
    ) then
        raise exception using errcode = 'P0001', message = 'normalized Match에 생성할 수 없는 Single node key가 있습니다.';
    end if;
    if exists (
        select 1
          from ypl_schema_validation.matches as m
         where m.event_id = p_event_id
           and m.source = 'normalized_bracket_runtime'
           and (m.match_kind <> 'bracket'
                or m.parent_match_id is not null
                or m.entry_a_id is null or m.entry_b_id is null
                or m.player_a_id is not null or m.player_b_id is not null
                or m.winner_player_id is not null
                or m.round_number is null
                or m.round_number is distinct from substring(m.source_node_key from '^single:r([0-9]+):m[0-9]+$')::smallint
                or m.stage_label is distinct from '본선 ' || substring(m.source_node_key from '^single:r([0-9]+):m[0-9]+$') || 'R'
                or m.sequence_no is distinct from (
                    power(2, substring(m.source_node_key from '^single:r([0-9]+):m[0-9]+$')::integer - 1)::integer
                    - 1 + substring(m.source_node_key from '^single:r[0-9]+:m([0-9]+)$')::integer
                )
                or m.resolution is distinct from case when m.winner_entry_id is null then 'unknown' else 'played' end)
    ) then
        raise exception using errcode = 'P0001', message = 'normalized Match field가 Single canonical contract와 일치하지 않습니다.';
    end if;

    v_target_round := substring(p_source_node_key from '^single:r([0-9]+):m[0-9]+$')::integer;
    v_target_match_no := substring(p_source_node_key from '^single:r[0-9]+:m([0-9]+)$')::integer;
    if v_target_round > v_max_round then
        raise exception using errcode = 'P0001', message = '생성할 수 없는 Single bracket round입니다.';
    end if;
    v_round_match_count := v_bracket_size;
    for v_round in 1..v_target_round loop
        v_round_match_count := v_round_match_count / 2;
    end loop;
    if v_target_match_no > v_round_match_count then
        raise exception using errcode = 'P0001', message = '생성할 수 없는 Single bracket match 번호입니다.';
    end if;

    -- A temporary projection table is transaction-local and is never a domain
    -- fact. It lets the function evaluate BYE auto-advancement and downstream
    -- winners without persisting future topology nodes.
    drop table if exists pg_temp.normalized_single_winner_nodes;
    create temporary table normalized_single_winner_nodes (
        source_node_key text primary key,
        round_no integer not null,
        match_no integer not null,
        entry_a_id uuid,
        entry_b_id uuid,
        winner_entry_id uuid,
        formed boolean not null,
        normalized_match_id uuid
    ) on commit drop;

    for v_match_no in 1..(v_bracket_size / 2) loop
        v_node_key := 'single:r1:m' || v_match_no::text;
        select a.entry_id, b.entry_id
          into v_entry_a, v_entry_b
          from (select s.entry_id from ypl_schema_validation.bracket_entry_slots as s
                 where s.bracket_runtime_id = p_runtime_id and s.event_id = p_event_id
                   and s.slot_no = (v_match_no * 2) - 1) a
          full join (select s.entry_id from ypl_schema_validation.bracket_entry_slots as s
                 where s.bracket_runtime_id = p_runtime_id and s.event_id = p_event_id
                   and s.slot_no = v_match_no * 2) b on true;
        v_formed := v_entry_a is not null and v_entry_b is not null;
        if not v_formed and v_entry_a is null and v_entry_b is null then
            raise exception using errcode = 'P0001', message = '첫 라운드 double-BYE topology입니다.';
        end if;
        v_winner := case when v_entry_a is not null and v_entry_b is null then v_entry_a
                         when v_entry_b is not null and v_entry_a is null then v_entry_b
                         else null end;
        select m.id, m.entry_a_id, m.entry_b_id, m.winner_entry_id
          into v_match_id, v_target_match.entry_a_id, v_target_match.entry_b_id, v_existing_winner
          from ypl_schema_validation.matches as m
         where m.event_id = p_event_id
           and m.source = 'normalized_bracket_runtime'
           and m.source_node_key = v_node_key;
        v_match_found := found;
        if v_match_found then
            if not v_formed or v_target_match.entry_a_id is distinct from v_entry_a
               or v_target_match.entry_b_id is distinct from v_entry_b then
                raise exception using errcode = 'P0001', message = 'persisted Match가 slot topology와 일치하지 않습니다.';
            end if;
            if v_existing_winner is not null
               and v_existing_winner not in (v_entry_a, v_entry_b) then
                raise exception using errcode = 'P0001', message = 'persisted Match winner가 양쪽 Entry가 아닙니다.';
            end if;
            elsif v_formed then
                raise exception using errcode = 'P0001', message = 'formed first-round Match가 누락되었습니다.';
        end if;
        insert into pg_temp.normalized_single_winner_nodes
            values (v_node_key, 1, v_match_no, v_entry_a, v_entry_b,
                    case when v_match_found then v_existing_winner else v_winner end,
                    v_formed, case when v_match_found then v_match_id else null end);
    end loop;

    for v_round in 2..v_max_round loop
        v_round_match_count := v_bracket_size;
        for v_desc_round in 1..v_round loop
            v_round_match_count := v_round_match_count / 2;
        end loop;
        for v_match_no in 1..v_round_match_count loop
            v_node_key := 'single:r' || v_round::text || ':m' || v_match_no::text;
            select n.winner_entry_id into v_entry_a
              from pg_temp.normalized_single_winner_nodes as n
             where n.source_node_key = 'single:r' || (v_round - 1)::text || ':m' || ((v_match_no * 2) - 1)::text;
            select n.winner_entry_id into v_entry_b
              from pg_temp.normalized_single_winner_nodes as n
             where n.source_node_key = 'single:r' || (v_round - 1)::text || ':m' || (v_match_no * 2)::text;
            v_formed := v_entry_a is not null and v_entry_b is not null;
            select m.id, m.entry_a_id, m.entry_b_id, m.winner_entry_id
              into v_match_id, v_target_match.entry_a_id, v_target_match.entry_b_id, v_existing_winner
              from ypl_schema_validation.matches as m
             where m.event_id = p_event_id
               and m.source = 'normalized_bracket_runtime'
               and m.source_node_key = v_node_key;
            v_match_found := found;
            if v_match_found then
                if not v_formed or v_target_match.entry_a_id is distinct from v_entry_a
                   or v_target_match.entry_b_id is distinct from v_entry_b then
                    raise exception using errcode = 'P0001', message = 'downstream Match가 canonical topology와 일치하지 않습니다.';
                end if;
                if v_existing_winner is not null
                   and v_existing_winner not in (v_entry_a, v_entry_b) then
                    raise exception using errcode = 'P0001', message = 'downstream Match winner가 양쪽 Entry가 아닙니다.';
                end if;
            elsif v_formed
               and not (v_round > v_target_round
                        and ((v_target_match_no - 1) / power(2, v_round - v_target_round)::integer) + 1 = v_match_no) then
                raise exception using errcode = 'P0001', message = 'formed downstream Match가 누락되었습니다.';
            end if;
            insert into pg_temp.normalized_single_winner_nodes
                values (v_node_key, v_round, v_match_no, v_entry_a, v_entry_b,
                        case when v_match_found then v_existing_winner else null end,
                        v_formed, case when v_match_found then v_match_id else null end);
        end loop;
    end loop;

    select m.*
      into v_target_match
      from ypl_schema_validation.matches as m
     where m.event_id = p_event_id
       and m.source = 'normalized_bracket_runtime'
       and m.source_node_key = p_source_node_key
     for update;
    if not found then
        raise exception using errcode = 'P0001', message = 'winner mutation 대상 Match가 없습니다. BYE/future node는 변경할 수 없습니다.';
    end if;
    if v_target_match.entry_a_id is null or v_target_match.entry_b_id is null then
        raise exception using errcode = 'P0001', message = 'formed Match가 아닌 node는 winner mutation 대상이 아닙니다.';
    end if;
    if p_winner_entry_id is not null
       and p_winner_entry_id not in (v_target_match.entry_a_id, v_target_match.entry_b_id) then
        raise exception using errcode = 'P0001', message = 'winner는 target Match의 양쪽 Entry 중 하나여야 합니다.';
    end if;

    if v_target_match.winner_entry_id is not distinct from p_winner_entry_id then
        if exists (
            select 1
              from pg_temp.normalized_single_winner_nodes as n
             where n.formed
               and n.normalized_match_id is null
               and n.round_no > v_target_round
               and ((v_target_match_no - 1) / power(2, n.round_no - v_target_round)::integer) + 1 = n.match_no
        ) then
            v_repair_only := true;
        else
            return query select p_runtime_id, p_event_id, p_source_node_key,
                                v_target_match.winner_entry_id, p_winner_entry_id,
                                0, 0, false;
            return;
        end if;
    end if;

    -- Remove only the target node's descendant chain, deepest first. Sibling
    -- subtrees and the target Match itself remain intact.
    if not v_repair_only then
      for v_desc_round in reverse v_max_round..(v_target_round + 1) loop
        v_round_match_count := v_bracket_size;
        for v_round in 1..v_desc_round loop
            v_round_match_count := v_round_match_count / 2;
        end loop;
        for v_desc_match_no in 1..v_round_match_count loop
            if ((v_target_match_no - 1) / power(2, v_desc_round - v_target_round)::integer) + 1 = v_desc_match_no then
                delete from ypl_schema_validation.matches as m
                 where m.event_id = p_event_id
                   and m.source = 'normalized_bracket_runtime'
                   and m.source_node_key = 'single:r' || v_desc_round::text || ':m' || v_desc_match_no::text;
                get diagnostics v_deleted = row_count;
                v_deleted_downstream := v_deleted_downstream + v_deleted;
            end if;
        end loop;
      end loop;

      update ypl_schema_validation.matches as m
       set winner_entry_id = p_winner_entry_id,
           resolution = case when p_winner_entry_id is null then 'unknown' else 'played' end,
           played_at = case when p_winner_entry_id is null then null else now() end,
           updated_at = now()
     where m.id = v_target_match.id
       and m.event_id = p_event_id
       and m.source = 'normalized_bracket_runtime';
      if not found then
          raise exception using errcode = 'P0001', message = 'target Match update ownership이 변경되었습니다.';
      end if;
    end if;

    -- Re-evaluate only the affected chain. A newly formed node receives a new
    -- Match with winner NULL; old descendant winners are never carried forward.
    if not v_repair_only then
      update pg_temp.normalized_single_winner_nodes as n
         set winner_entry_id = case when n.source_node_key = p_source_node_key then p_winner_entry_id else n.winner_entry_id end
       where n.source_node_key = p_source_node_key;
    end if;
    for v_round in (v_target_round + 1)..v_max_round loop
        v_round_match_count := v_bracket_size;
        for v_desc_round in 1..v_round loop
            v_round_match_count := v_round_match_count / 2;
        end loop;
        for v_match_no in 1..v_round_match_count loop
            if ((v_target_match_no - 1) / power(2, v_round - v_target_round)::integer) + 1 <> v_match_no then
                continue;
            end if;
            v_node_key := 'single:r' || v_round::text || ':m' || v_match_no::text;
            select n.winner_entry_id into v_entry_a
              from pg_temp.normalized_single_winner_nodes as n
             where n.source_node_key = 'single:r' || (v_round - 1)::text || ':m' || ((v_match_no * 2) - 1)::text;
            select n.winner_entry_id into v_entry_b
              from pg_temp.normalized_single_winner_nodes as n
             where n.source_node_key = 'single:r' || (v_round - 1)::text || ':m' || (v_match_no * 2)::text;
            v_formed := v_entry_a is not null and v_entry_b is not null;
            select n.normalized_match_id into v_match_id
              from pg_temp.normalized_single_winner_nodes as n where n.source_node_key = v_node_key;
            if not v_formed then
                update pg_temp.normalized_single_winner_nodes as n
                   set entry_a_id = v_entry_a, entry_b_id = v_entry_b,
                       winner_entry_id = null, formed = false, normalized_match_id = null
                 where n.source_node_key = v_node_key;
                continue;
            end if;
            insert into ypl_schema_validation.matches (
                event_id, match_kind, parent_match_id, round_number, stage_label,
                sequence_no, entry_a_id, entry_b_id, player_a_id, player_b_id,
                winner_entry_id, winner_player_id, resolution, source,
                source_node_key, played_at
            ) values (
                p_event_id, 'bracket', null, v_round, '본선 ' || v_round::text || 'R',
                ((power(2, v_round - 1)::integer) - 1 + v_match_no),
                v_entry_a, v_entry_b, null, null, null, null, 'unknown',
                'normalized_bracket_runtime', v_node_key, null
            ) returning id into v_match_id;
            v_created_downstream := v_created_downstream + 1;
            update pg_temp.normalized_single_winner_nodes as n
               set entry_a_id = v_entry_a, entry_b_id = v_entry_b,
                   winner_entry_id = null, formed = true, normalized_match_id = v_match_id
             where n.source_node_key = v_node_key;
        end loop;
    end loop;

    return query select p_runtime_id, p_event_id, p_source_node_key,
                        v_target_match.winner_entry_id, p_winner_entry_id,
                        v_deleted_downstream, v_created_downstream, not v_repair_only;
end;
$$;

-- SECURITY INVOKER functions must not inherit PUBLIC EXECUTE. Only anon is
-- granted the draft RPC; authenticated/service_role and RLS are unchanged.
revoke all on function ypl_schema_validation.set_normalized_single_bracket_winner(uuid, uuid, text, uuid) from public;
revoke all on function ypl_schema_validation.set_normalized_single_bracket_winner(uuid, uuid, text, uuid) from authenticated, service_role;
grant execute on function ypl_schema_validation.set_normalized_single_bracket_winner(uuid, uuid, text, uuid) to anon;
