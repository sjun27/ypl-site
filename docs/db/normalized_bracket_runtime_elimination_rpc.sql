-- YPL normalized Team/Double bracket runtime RPC contract.
-- Test schema additive migration only. Do not run on Production.
--
-- The existing Single individual RPCs remain authoritative for individual
-- Single runtime identity creation/winner mutation. This contract is used by
-- the Team Single and Double paths already wired in the frontend.

alter table ypl_schema_validation.bracket_runtimes
    drop constraint if exists bracket_runtimes_topology_kind_check;

alter table ypl_schema_validation.bracket_runtimes
    add constraint bracket_runtimes_topology_kind_check
    check (topology_kind in ('single_elimination', 'double_elimination'));

create or replace function ypl_schema_validation.create_normalized_bracket_runtime(
    p_runtime_id uuid,
    p_event_id uuid,
    p_topology_kind text,
    p_participants jsonb,
    p_slots jsonb
)
returns table (
    runtime_id uuid,
    event_id uuid,
    topology_kind text,
    participant_count integer,
    slot_count integer,
    created boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_event ypl_schema_validation.events%rowtype;
    v_runtime ypl_schema_validation.bracket_runtimes%rowtype;
    v_participant record;
    v_row_count integer;
    v_entry_count integer;
    v_slot_count integer;
    v_size integer := 1;
    v_existing boolean := false;
begin
    if p_runtime_id is null or p_event_id is null
       or p_topology_kind not in ('single_elimination', 'double_elimination')
       or coalesce(jsonb_typeof(p_participants), '') <> 'array'
       or coalesce(jsonb_typeof(p_slots), '') <> 'array' then
        raise exception using errcode = 'P0001', message = 'runtime, topology, participant, draw payload가 올바르지 않습니다.';
    end if;

    select * into v_event
      from ypl_schema_validation.events
     where id = p_event_id
     for update;
    if not found then
        raise exception using errcode = 'P0001', message = '연결된 Event를 찾을 수 없습니다.';
    end if;
    if v_event.competition_format <> p_topology_kind
       or v_event.status not in ('open', 'running')
       or v_event.record_applied_at is not null then
        raise exception using errcode = 'P0001', message = 'Event와 normalized runtime topology/status가 일치하지 않습니다.';
    end if;
    if p_topology_kind = 'single_elimination' and not v_event.is_team_event then
        raise exception using errcode = 'P0001', message = '개인전 Single은 기존 Single runtime RPC를 사용해야 합니다.';
    end if;

    select count(*)::integer into v_row_count
      from jsonb_to_recordset(p_participants) as p(
        participant_key text, display_name text, entry_type text,
        player_id uuid, registration_id uuid, entry_id uuid,
        entry_participant_id uuid, member_order smallint, role text,
        player_was_created boolean, registration_was_created boolean,
        registration_player_was_changed boolean, previous_registration_player_id uuid,
        entry_was_created boolean, entry_participant_was_created boolean
      );
    if v_row_count < 2 then
        raise exception using errcode = 'P0001', message = 'normalized bracket identity가 2개 미만입니다.';
    end if;
    if exists (
        select 1
          from jsonb_to_recordset(p_participants) as p(
            participant_key text, display_name text, entry_type text,
            player_id uuid, registration_id uuid, entry_id uuid,
            entry_participant_id uuid, member_order smallint, role text,
            player_was_created boolean, registration_was_created boolean,
            registration_player_was_changed boolean, previous_registration_player_id uuid,
            entry_was_created boolean, entry_participant_was_created boolean
          )
         where nullif(btrim(coalesce(p.participant_key, '')), '') is null
            or nullif(btrim(coalesce(p.display_name, '')), '') is null
            or p.entry_type <> case when v_event.is_team_event then 'team' else 'individual' end
            or p.player_id is null or p.registration_id is null
            or p.entry_id is null or p.entry_participant_id is null
            or p.member_order is null
    ) then
        raise exception using errcode = 'P0001', message = 'normalized identity 필드가 누락되었거나 Event Entry type과 일치하지 않습니다.';
    end if;
    if (select count(distinct participant_key)::integer from jsonb_to_recordset(p_participants) as p(
        participant_key text, display_name text, entry_type text, player_id uuid,
        registration_id uuid, entry_id uuid, entry_participant_id uuid, member_order smallint,
        role text, player_was_created boolean, registration_was_created boolean,
        registration_player_was_changed boolean, previous_registration_player_id uuid,
        entry_was_created boolean, entry_participant_was_created boolean
    )) <> v_row_count
       or (select count(distinct entry_participant_id)::integer from jsonb_to_recordset(p_participants) as p(
        participant_key text, display_name text, entry_type text, player_id uuid,
        registration_id uuid, entry_id uuid, entry_participant_id uuid, member_order smallint,
        role text, player_was_created boolean, registration_was_created boolean,
        registration_player_was_changed boolean, previous_registration_player_id uuid,
        entry_was_created boolean, entry_participant_was_created boolean
    )) <> v_row_count
       or (select count(distinct registration_id)::integer from jsonb_to_recordset(p_participants) as p(
        participant_key text, display_name text, entry_type text, player_id uuid,
        registration_id uuid, entry_id uuid, entry_participant_id uuid, member_order smallint,
        role text, player_was_created boolean, registration_was_created boolean,
        registration_player_was_changed boolean, previous_registration_player_id uuid,
        entry_was_created boolean, entry_participant_was_created boolean
    )) <> v_row_count
       or (select count(distinct player_id)::integer from jsonb_to_recordset(p_participants) as p(
        participant_key text, display_name text, entry_type text, player_id uuid,
        registration_id uuid, entry_id uuid, entry_participant_id uuid, member_order smallint,
        role text, player_was_created boolean, registration_was_created boolean,
        registration_player_was_changed boolean, previous_registration_player_id uuid,
        entry_was_created boolean, entry_participant_was_created boolean
    )) <> v_row_count then
        raise exception using errcode = 'P0001', message = 'normalized identity key가 중복되었습니다.';
    end if;

    select count(distinct p.entry_id)::integer into v_entry_count
      from jsonb_to_recordset(p_participants) as p(
        participant_key text, display_name text, entry_type text, player_id uuid,
        registration_id uuid, entry_id uuid, entry_participant_id uuid, member_order smallint,
        role text, player_was_created boolean, registration_was_created boolean,
        registration_player_was_changed boolean, previous_registration_player_id uuid,
        entry_was_created boolean, entry_participant_was_created boolean
      );
    if v_entry_count < 2 then
        raise exception using errcode = 'P0001', message = 'normalized bracket Entry가 2개 미만입니다.';
    end if;
    if v_event.is_team_event and exists (
        select 1
          from (
            select entry_id, count(*)::integer as member_count,
                   min(member_order)::integer as min_order,
                   max(member_order)::integer as max_order,
                   count(distinct member_order)::integer as distinct_orders,
                   count(*) filter (where role = 'captain')::integer as captain_count,
                   count(*) filter (where member_order = 1 and role = 'captain')::integer as first_captain_count
              from jsonb_to_recordset(p_participants) as p(
                participant_key text, display_name text, entry_type text, player_id uuid,
                registration_id uuid, entry_id uuid, entry_participant_id uuid, member_order smallint,
                role text, player_was_created boolean, registration_was_created boolean,
                registration_player_was_changed boolean, previous_registration_player_id uuid,
                entry_was_created boolean, entry_participant_was_created boolean
              )
             group by entry_id
          ) as team_members
         where min_order <> 1 or max_order <> member_count
            or distinct_orders <> member_count
            or captain_count <> 1 or first_captain_count <> 1
    ) then
        raise exception using errcode = 'P0001', message = 'Team EntryParticipant member_order/captain contract가 올바르지 않습니다.';
    end if;
    if not v_event.is_team_event and exists (
        select 1 from jsonb_to_recordset(p_participants) as p(
          participant_key text, display_name text, entry_type text, player_id uuid,
          registration_id uuid, entry_id uuid, entry_participant_id uuid, member_order smallint,
          role text, player_was_created boolean, registration_was_created boolean,
          registration_player_was_changed boolean, previous_registration_player_id uuid,
          entry_was_created boolean, entry_participant_was_created boolean
        ) where p.member_order <> 1
    ) then
        raise exception using errcode = 'P0001', message = '개인전 EntryParticipant member_order가 올바르지 않습니다.';
    end if;
    while v_size < v_entry_count loop v_size := v_size * 2; end loop;

    select count(*)::integer into v_slot_count
      from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid);
    if v_slot_count <> v_entry_count
       or exists (select 1 from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid) where s.slot_no is null or s.entry_id is null)
       or (select count(distinct slot_no)::integer from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)) <> v_slot_count
       or (select count(distinct entry_id)::integer from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)) <> v_slot_count
       or exists (select 1 from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid) where s.slot_no < 1 or s.slot_no > v_size)
       or exists (
          select 1
            from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)
            left join (select distinct entry_id from jsonb_to_recordset(p_participants) as p(
              participant_key text, display_name text, entry_type text, player_id uuid,
              registration_id uuid, entry_id uuid, entry_participant_id uuid, member_order smallint,
              role text, player_was_created boolean, registration_was_created boolean,
              registration_player_was_changed boolean, previous_registration_player_id uuid,
              entry_was_created boolean, entry_participant_was_created boolean
            )) as p on p.entry_id = s.entry_id
           where p.entry_id is null
       ) then
        raise exception using errcode = 'P0001', message = 'normalized draw slot이 Entry identity와 일치하지 않습니다.';
    end if;
    if exists (
        with slots as (select slot_no, entry_id from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid))
        select 1
          from generate_series(1, v_size / 2) as g(match_no)
          left join slots a on a.slot_no = g.match_no * 2 - 1
          left join slots b on b.slot_no = g.match_no * 2
         where a.entry_id is null and b.entry_id is null
    ) then
        raise exception using errcode = 'P0001', message = '첫 라운드에 double-BYE가 있습니다.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('normalized-bracket-runtime:' || p_runtime_id::text, 0));
    select * into v_runtime
      from ypl_schema_validation.bracket_runtimes
     where id = p_runtime_id;
    if found then
        v_existing := true;
        if v_runtime.event_id <> p_event_id or v_runtime.topology_kind <> p_topology_kind then
            raise exception using errcode = 'P0001', message = 'runtime_id ownership/topology가 일치하지 않습니다.';
        end if;
    end if;
    if exists (
        select 1 from ypl_schema_validation.bracket_runtimes br
         where br.event_id = p_event_id and br.id <> p_runtime_id
    ) then
        raise exception using errcode = 'P0001', message = 'Event에 다른 normalized runtime이 이미 존재합니다.';
    end if;

    if v_existing then
        if (select count(*) from ypl_schema_validation.bracket_identity_changes where bracket_runtime_id = p_runtime_id) <> v_row_count
           or exists (
              select 1
                from jsonb_to_recordset(p_participants) as p(
                  participant_key text, display_name text, entry_type text, player_id uuid,
                  registration_id uuid, entry_id uuid, entry_participant_id uuid, member_order smallint,
                  role text, player_was_created boolean, registration_was_created boolean,
                  registration_player_was_changed boolean, previous_registration_player_id uuid,
                  entry_was_created boolean, entry_participant_was_created boolean
                )
                left join ypl_schema_validation.bracket_identity_changes c
                  on c.bracket_runtime_id = p_runtime_id and c.entry_participant_id = p.entry_participant_id
               where c.entry_participant_id is null
                  or c.entry_id is distinct from p.entry_id
                  or c.registration_id is distinct from p.registration_id
                  or c.player_id is distinct from p.player_id
           )
           or exists (
              select slot_no, entry_id from ypl_schema_validation.bracket_entry_slots bes
               where bes.bracket_runtime_id = p_runtime_id and bes.event_id = p_event_id
              except
              select slot_no, entry_id from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)
           )
           or exists (
              select slot_no, entry_id from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)
              except
              select slot_no, entry_id from ypl_schema_validation.bracket_entry_slots bes
               where bes.bracket_runtime_id = p_runtime_id and bes.event_id = p_event_id
           ) then
            raise exception using errcode = 'P0001', message = '동일 runtime의 canonical identity/draw payload가 달라 retry를 거부했습니다.';
        end if;
        return query select p_runtime_id, p_event_id, p_topology_kind,
            (select count(distinct bic.entry_id)::integer from ypl_schema_validation.bracket_identity_changes bic where bic.bracket_runtime_id = p_runtime_id),
            (select count(*)::integer from ypl_schema_validation.bracket_entry_slots bes where bes.bracket_runtime_id = p_runtime_id and bes.event_id = p_event_id), false;
        return;
    end if;

    insert into ypl_schema_validation.bracket_runtimes(
        id, event_id, topology_kind, projection_version, previous_event_status
    ) values (p_runtime_id, p_event_id, p_topology_kind, 1, v_event.status);

    for v_participant in select * from jsonb_to_recordset(p_participants) as p(
        participant_key text, display_name text, entry_type text, player_id uuid,
        registration_id uuid, entry_id uuid, entry_participant_id uuid, member_order smallint,
        role text, player_was_created boolean, registration_was_created boolean,
        registration_player_was_changed boolean, previous_registration_player_id uuid,
        entry_was_created boolean, entry_participant_was_created boolean
    ) loop
        if not exists (
            select 1
              from ypl_schema_validation.entries e
              join ypl_schema_validation.entry_participants ep
                on ep.entry_id = e.id and ep.event_id = e.event_id
              join ypl_schema_validation.event_registrations er
                on er.id = ep.registration_id and er.event_id = ep.event_id
              join ypl_schema_validation.players pl on pl.id = ep.player_id
             where e.id = v_participant.entry_id and e.event_id = p_event_id
               and e.entry_type = v_participant.entry_type and e.status = 'active'
               and e.display_name = v_participant.display_name
               and ep.id = v_participant.entry_participant_id
               and ep.registration_id = v_participant.registration_id
               and ep.player_id = v_participant.player_id
               and ep.member_order = v_participant.member_order
               and ep.role is not distinct from v_participant.role
               and er.player_id = v_participant.player_id
               and pl.id = v_participant.player_id
        ) then
            raise exception using errcode = 'P0001', message = 'Entry/EntryParticipant canonical identity가 runtime payload와 일치하지 않습니다.';
        end if;
        insert into ypl_schema_validation.bracket_identity_changes(
            bracket_runtime_id, event_id, entry_participant_id, entry_id, registration_id, player_id,
            player_was_created, registration_was_created, registration_player_was_changed,
            previous_registration_player_id, entry_was_created, entry_participant_was_created
        ) values (
            p_runtime_id, p_event_id, v_participant.entry_participant_id, v_participant.entry_id,
            v_participant.registration_id, v_participant.player_id,
            coalesce(v_participant.player_was_created, false), coalesce(v_participant.registration_was_created, false),
            coalesce(v_participant.registration_player_was_changed, false), v_participant.previous_registration_player_id,
            coalesce(v_participant.entry_was_created, false), coalesce(v_participant.entry_participant_was_created, false)
        );
    end loop;

    insert into ypl_schema_validation.bracket_entry_slots(
        bracket_runtime_id, event_id, stage_kind, stage_no, pool_no, slot_no, entry_id
    )
    select p_runtime_id, p_event_id, 'elimination', 1, 0, s.slot_no, s.entry_id
      from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid);

    update ypl_schema_validation.events
       set status = 'running', updated_at = now()
     where id = p_event_id;
    return query select p_runtime_id, p_event_id, p_topology_kind, v_entry_count, v_slot_count, true;
end;
$$;

create or replace function ypl_schema_validation.delete_normalized_bracket_runtime(
    p_runtime_id uuid,
    p_event_id uuid
)
returns table (
    runtime_id uuid,
    event_id uuid,
    deleted_match_count integer,
    deleted boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_event ypl_schema_validation.events%rowtype;
    v_runtime ypl_schema_validation.bracket_runtimes%rowtype;
    v_identity_count integer;
    v_match_count integer;
begin
    if p_runtime_id is null or p_event_id is null then
        raise exception using errcode = 'P0001', message = 'runtime_id와 event_id가 필요합니다.';
    end if;

    select * into v_event
      from ypl_schema_validation.events
     where id = p_event_id
     for update;
    if not found then
        raise exception using errcode = 'P0001', message = '삭제 대상 Event를 찾을 수 없습니다.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('normalized-bracket-runtime:' || p_runtime_id::text, 0));
    select * into v_runtime
      from ypl_schema_validation.bracket_runtimes br
     where br.id = p_runtime_id and br.event_id = p_event_id;
    if not found then
        raise exception using errcode = 'P0001', message = 'normalized runtime ownership이 일치하지 않습니다.';
    end if;
    if v_runtime.topology_kind <> v_event.competition_format
       or (v_runtime.topology_kind = 'single_elimination' and not v_event.is_team_event)
       or v_event.status not in ('open', 'running')
       or v_event.record_applied_at is not null then
        raise exception using errcode = 'P0001', message = '기록 반영 전 허용된 Team/Double runtime만 삭제할 수 있습니다.';
    end if;
    if exists (select 1 from ypl_schema_validation.results r0 where r0.event_id = p_event_id)
       or exists (select 1 from ypl_schema_validation.ranking_awards a0 where a0.event_id = p_event_id) then
        raise exception using errcode = 'P0001', message = 'Result 또는 RankingAward가 있어 runtime 삭제를 중단했습니다.';
    end if;

    select count(*)::integer into v_identity_count
      from ypl_schema_validation.bracket_identity_changes bic0
     where bic0.bracket_runtime_id = p_runtime_id and bic0.event_id = p_event_id;
    if v_identity_count < 2 then
        raise exception using errcode = 'P0001', message = 'runtime identity ownership metadata가 부족합니다.';
    end if;
    if exists (
        select 1
          from ypl_schema_validation.bracket_identity_changes c
          left join ypl_schema_validation.entries e
            on e.id = c.entry_id and e.event_id = p_event_id
          left join ypl_schema_validation.entry_participants ep
            on ep.id = c.entry_participant_id and ep.event_id = p_event_id
           and ep.entry_id = c.entry_id and ep.registration_id = c.registration_id and ep.player_id = c.player_id
          left join ypl_schema_validation.event_registrations er
            on er.id = c.registration_id and er.event_id = p_event_id and er.player_id = c.player_id
          left join ypl_schema_validation.players pl on pl.id = c.player_id
         where c.bracket_runtime_id = p_runtime_id and c.event_id = p_event_id
           and (e.id is null or e.entry_type <> case when v_event.is_team_event then 'team' else 'individual' end
             or e.status <> 'active' or ep.id is null or er.id is null or pl.id is null)
    ) then
        raise exception using errcode = 'P0001', message = 'runtime identity ownership exact-match가 깨져 삭제를 중단했습니다.';
    end if;

    if exists (
        select 1 from ypl_schema_validation.matches m0
         where m0.event_id = p_event_id and m0.source <> 'normalized_bracket_runtime'
    ) then
        raise exception using errcode = 'P0001', message = 'foreign-source Match가 있어 runtime 삭제를 중단했습니다.';
    end if;
    if exists (
        select 1
          from ypl_schema_validation.matches m
         where m.event_id = p_event_id
           and m.source = 'normalized_bracket_runtime'
           and (
             (m.match_kind = 'bracket' and (
                m.parent_match_id is not null or m.entry_a_id is null or m.entry_b_id is null
                or m.player_a_id is not null or m.player_b_id is not null or m.winner_player_id is not null
                or (v_runtime.topology_kind = 'double_elimination'
                    and m.source_node_key !~ '^double:(w|l):r[1-9][0-9]*:m[1-9][0-9]*$'
                    and m.source_node_key not in ('double:gf:m1', 'double:reset:m1'))
                or (v_runtime.topology_kind = 'single_elimination'
                    and m.source_node_key !~ '^single:r[1-9][0-9]*:m[1-9][0-9]*$')
             ))
             or (m.match_kind in ('team_bout', 'ace') and (
                not v_event.is_team_event or m.parent_match_id is null
                or m.entry_a_id is not null or m.entry_b_id is not null
                or m.player_a_id is null or m.player_b_id is null or m.winner_entry_id is not null
                or not exists (
                    select 1 from ypl_schema_validation.matches parent
                     where parent.id = m.parent_match_id and parent.event_id = p_event_id
                       and parent.source = 'normalized_bracket_runtime' and parent.match_kind = 'bracket'
                       and (m.source_node_key = parent.source_node_key || ':ace'
                         or m.source_node_key ~ ('^' || parent.source_node_key || ':bout:[1-9][0-9]*$'))
                )
             ))
             or m.match_kind not in ('bracket', 'team_bout', 'ace')
           )
    ) then
        raise exception using errcode = 'P0001', message = 'normalized Match shape/source ownership이 runtime contract와 다릅니다.';
    end if;
    if exists (
        select 1 from ypl_schema_validation.matches m0
         where m0.event_id = p_event_id and m0.source = 'normalized_bracket_runtime'
         group by m0.source_node_key having count(*) > 1
    ) then
        raise exception using errcode = 'P0001', message = 'normalized Match source_node_key가 중복되어 삭제를 중단했습니다.';
    end if;

    select count(*)::integer into v_match_count
      from ypl_schema_validation.matches m0
     where m0.event_id = p_event_id and m0.source = 'normalized_bracket_runtime';

    -- Only runtime artifacts are removed. Domain identity rows remain owned by
    -- the existing Event participant confirmation lifecycle.
    delete from ypl_schema_validation.matches m0
     where m0.event_id = p_event_id and m0.source = 'normalized_bracket_runtime';
    delete from ypl_schema_validation.bracket_entry_slots bes0
     where bes0.bracket_runtime_id = p_runtime_id and bes0.event_id = p_event_id;
    delete from ypl_schema_validation.bracket_identity_changes bic0
     where bic0.bracket_runtime_id = p_runtime_id and bic0.event_id = p_event_id;
    delete from ypl_schema_validation.bracket_runtimes br0
     where br0.id = p_runtime_id and br0.event_id = p_event_id;
    update ypl_schema_validation.events
       set status = v_runtime.previous_event_status, updated_at = now()
     where id = p_event_id;

    return query select p_runtime_id, p_event_id, v_match_count, true;
end;
$$;

revoke all on function ypl_schema_validation.create_normalized_bracket_runtime(uuid, uuid, text, jsonb, jsonb) from public;
revoke all on function ypl_schema_validation.create_normalized_bracket_runtime(uuid, uuid, text, jsonb, jsonb) from authenticated, service_role;
grant execute on function ypl_schema_validation.create_normalized_bracket_runtime(uuid, uuid, text, jsonb, jsonb) to anon;
revoke all on function ypl_schema_validation.delete_normalized_bracket_runtime(uuid, uuid) from public;
revoke all on function ypl_schema_validation.delete_normalized_bracket_runtime(uuid, uuid) from authenticated, service_role;
grant execute on function ypl_schema_validation.delete_normalized_bracket_runtime(uuid, uuid) to anon;
