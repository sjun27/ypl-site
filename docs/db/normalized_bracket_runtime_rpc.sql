-- YPL normalized individual Single Elimination runtime RPC draft
-- Status: DRAFT / DO NOT RUN ON PRODUCTION
--
-- This file is not installed by P2-7B2A. It is an additive RPC contract for
-- ypl_schema_validation. The caller supplies every identity UUID, including
-- IDs for rows that may be created, so a lost response can be retried without
-- generating a different ownership graph.
--
-- JSON contract:
-- p_participants is an array of objects:
--   participant_key, display_name, player_id, registration_id,
--   entry_id, entry_participant_id
-- p_slots is an array of objects:
--   slot_no, entry_id
-- participant_key is an input correlation key only. It is not a domain fact
-- and is deliberately not persisted; retry identity is the supplied UUID graph,
-- canonical display names, and the persisted draw slots.
-- Only Single Elimination initial slots are accepted. BYE is represented by
-- an absent slot row and future nodes are not persisted.

-- =========================================================
-- CREATE
-- =========================================================

create or replace function ypl_schema_validation.create_normalized_single_bracket_runtime(
    p_runtime_id uuid,
    p_event_id uuid,
    p_participants jsonb,
    p_slots jsonb
)
returns table (
    runtime_id uuid,
    event_id uuid,
    participant_count integer,
    slot_count integer,
    match_count integer,
    created boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_event ypl_schema_validation.events%rowtype;
    v_runtime ypl_schema_validation.bracket_runtimes%rowtype;
    v_player ypl_schema_validation.players%rowtype;
    v_registration ypl_schema_validation.event_registrations%rowtype;
    v_entry ypl_schema_validation.entries%rowtype;
    v_entry_participant ypl_schema_validation.entry_participants%rowtype;
    v_participant record;
    v_participant_count integer;
    v_slot_count integer;
    v_bracket_size integer := 1;
    v_match_count integer;
    v_double_bye_count integer;
    v_player_was_created boolean;
    v_registration_was_created boolean;
    v_registration_player_was_changed boolean;
    v_entry_was_created boolean;
    v_entry_participant_was_created boolean;
    v_previous_registration_player_id uuid;
    v_runtime_exists boolean := false;
begin
    if p_runtime_id is null or p_event_id is null then
        raise exception using errcode = 'P0001', message = 'runtime_id와 event_id가 필요합니다.';
    end if;

    if jsonb_typeof(p_participants) <> 'array'
       or jsonb_typeof(p_slots) <> 'array' then
        raise exception using errcode = 'P0001', message = '참가자와 draw slot은 JSON 배열이어야 합니다.';
    end if;

    select *
      into v_event
      from ypl_schema_validation.events
     where id = p_event_id
     for update;

    if not found then
        raise exception using errcode = 'P0001', message = '연결된 Event를 찾을 수 없습니다.';
    end if;
    if v_event.is_team_event then
        raise exception using errcode = 'P0001', message = '개인전 Event만 normalized Single runtime을 생성할 수 있습니다.';
    end if;
    if v_event.competition_format <> 'single_elimination' then
        raise exception using errcode = 'P0001', message = 'competition_format이 single_elimination이 아닙니다.';
    end if;
    if v_event.record_applied_at is not null or v_event.status not in ('open', 'running') then
        raise exception using errcode = 'P0001', message = '현재 Event 상태에서는 normalized bracket을 생성할 수 없습니다.';
    end if;

    select count(*)::integer into v_participant_count
      from jsonb_to_recordset(p_participants) as p(
          participant_key text,
          display_name text,
          player_id uuid,
          registration_id uuid,
          entry_id uuid,
          entry_participant_id uuid
      )
     where nullif(btrim(coalesce(p.participant_key, '')), '') is null
        or nullif(btrim(coalesce(p.display_name, '')), '') is null
        or p.player_id is null
        or p.registration_id is null
        or p.entry_id is null
        or p.entry_participant_id is null;
    if v_participant_count > 0 then
        raise exception using errcode = 'P0001', message = '참가자 identity와 display_name은 모두 필요합니다.';
    end if;

    select count(*)::integer into v_participant_count
      from jsonb_to_recordset(p_participants) as p(
          participant_key text,
          display_name text,
          player_id uuid,
          registration_id uuid,
          entry_id uuid,
          entry_participant_id uuid
      );
    if v_participant_count < 2 then
        raise exception using errcode = 'P0001', message = 'Single bracket 참가자는 2명 이상이어야 합니다.';
    end if;

    if (select count(distinct participant_key)::integer from jsonb_to_recordset(p_participants) as p(
        participant_key text, display_name text, player_id uuid, registration_id uuid,
        entry_id uuid, entry_participant_id uuid
    )) <> v_participant_count
    or (select count(distinct player_id)::integer from jsonb_to_recordset(p_participants) as p(
        participant_key text, display_name text, player_id uuid, registration_id uuid,
        entry_id uuid, entry_participant_id uuid
    )) <> v_participant_count
    or (select count(distinct registration_id)::integer from jsonb_to_recordset(p_participants) as p(
        participant_key text, display_name text, player_id uuid, registration_id uuid,
        entry_id uuid, entry_participant_id uuid
    )) <> v_participant_count
    or (select count(distinct entry_id)::integer from jsonb_to_recordset(p_participants) as p(
        participant_key text, display_name text, player_id uuid, registration_id uuid,
        entry_id uuid, entry_participant_id uuid
    )) <> v_participant_count
    or (select count(distinct entry_participant_id)::integer from jsonb_to_recordset(p_participants) as p(
        participant_key text, display_name text, player_id uuid, registration_id uuid,
        entry_id uuid, entry_participant_id uuid
    )) <> v_participant_count then
        raise exception using errcode = 'P0001', message = 'participant identity 중복이 있어 bracket을 생성할 수 없습니다.';
    end if;

    while v_bracket_size < v_participant_count loop
        v_bracket_size := v_bracket_size * 2;
    end loop;

    select count(*)::integer into v_slot_count
      from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)
     where s.slot_no is null or s.entry_id is null;
    if v_slot_count > 0 then
        raise exception using errcode = 'P0001', message = 'slot_no와 entry_id는 모두 필요합니다.';
    end if;

    select count(*)::integer into v_slot_count
      from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid);
    if v_slot_count <> v_participant_count then
        raise exception using errcode = 'P0001', message = '모든 참가자는 정확히 하나의 initial slot을 가져야 합니다.';
    end if;
    if (select count(distinct slot_no)::integer from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)) <> v_slot_count
       or (select count(distinct entry_id)::integer from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)) <> v_slot_count then
        raise exception using errcode = 'P0001', message = 'slot 또는 Entry가 중복되었습니다.';
    end if;
    if exists (
        select 1
          from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)
         where s.slot_no < 1 or s.slot_no > v_bracket_size
    ) then
        raise exception using errcode = 'P0001', message = 'slot_no가 bracket 범위를 벗어났습니다.';
    end if;
    if exists (
        select 1
          from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)
          left join jsonb_to_recordset(p_participants) as p(
              participant_key text, display_name text, player_id uuid, registration_id uuid,
              entry_id uuid, entry_participant_id uuid
          ) on p.entry_id = s.entry_id
         where p.entry_id is null
    ) then
        raise exception using errcode = 'P0001', message = 'draw slot의 Entry가 participant payload와 일치하지 않습니다.';
    end if;

    with slots as (
        select slot_no, entry_id
          from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)
    )
    select count(*)::integer
      into v_double_bye_count
      from generate_series(1, v_bracket_size / 2) as m(match_no)
      left join slots a on a.slot_no = (m.match_no * 2) - 1
      left join slots b on b.slot_no = m.match_no * 2
     where a.entry_id is null and b.entry_id is null;
    if v_double_bye_count > 0 then
        raise exception using errcode = 'P0001', message = '첫 라운드에 double-BYE match가 있어 draw를 생성할 수 없습니다.';
    end if;

    -- Runtime identity is checked by both supplied id and Event. A different
    -- runtime for the same Event, or an id reused for another Event, fails.
    -- Event locking serializes all runtime mutations. Use an advisory
    -- runtime-id lock so SECURITY INVOKER does not require anon UPDATE on
    -- the immutable runtime table.
    perform pg_advisory_xact_lock(hashtextextended('normalized-single-runtime:' || p_runtime_id::text, 0));
    select * into v_runtime
      from ypl_schema_validation.bracket_runtimes
     where id = p_runtime_id
     ;
    if found then
        v_runtime_exists := true;
        if v_runtime.event_id <> p_event_id then
            raise exception using errcode = 'P0001', message = 'runtime_id가 다른 Event에 이미 사용되었습니다.';
        end if;
    end if;

    select * into v_runtime
      from ypl_schema_validation.bracket_runtimes as br
     where br.event_id = p_event_id
     ;
    if found and v_runtime.id <> p_runtime_id then
        raise exception using errcode = 'P0001', message = 'Event에 다른 normalized runtime이 이미 존재합니다.';
    end if;
    if found then
        v_runtime_exists := true;
    end if;

    if v_runtime_exists then
        if v_runtime.topology_kind <> 'single_elimination'
           or v_runtime.projection_version <> 1
           or v_event.status <> 'running' then
            raise exception using errcode = 'P0001', message = '기존 runtime 상태가 canonical create 결과와 일치하지 않습니다.';
        end if;
        if exists (
            select 1
              from ypl_schema_validation.matches as m0
             where m0.event_id = p_event_id
               and m0.source <> 'normalized_bracket_runtime'
        ) then
            raise exception using errcode = 'P0001', message = '기존 runtime에 다른 source Match가 있어 retry를 거부했습니다.';
        end if;

        if (select count(*) from ypl_schema_validation.bracket_identity_changes where bracket_runtime_id = p_runtime_id) <> v_participant_count
        or exists (
            select 1
              from jsonb_to_recordset(p_participants) as p(
                  participant_key text, display_name text, player_id uuid, registration_id uuid,
                  entry_id uuid, entry_participant_id uuid
              )
              left join ypl_schema_validation.bracket_identity_changes c
                on c.bracket_runtime_id = p_runtime_id
               and c.entry_participant_id = p.entry_participant_id
              left join ypl_schema_validation.entries e
                on e.id = p.entry_id and e.event_id = p_event_id
              left join ypl_schema_validation.entry_participants ep
                on ep.id = p.entry_participant_id and ep.event_id = p_event_id
              left join ypl_schema_validation.event_registrations r
                on r.id = p.registration_id and r.event_id = p_event_id
              left join ypl_schema_validation.players pl on pl.id = p.player_id
             where c.entry_participant_id is null
                or c.entry_id is distinct from p.entry_id
                or c.registration_id is distinct from p.registration_id
                or c.player_id is distinct from p.player_id
                or e.id is null or e.entry_type <> 'individual' or e.status <> 'active'
                or e.display_name is distinct from btrim(p.display_name)
                or ep.entry_id is distinct from p.entry_id
                or ep.registration_id is distinct from p.registration_id
                or ep.player_id is distinct from p.player_id
                or ep.member_order is distinct from 1::smallint
                or r.player_id is distinct from p.player_id
                or r.registration_name is distinct from btrim(p.display_name)
                or pl.display_name is distinct from btrim(p.display_name)
        )
        or exists (
            select 1
              from ypl_schema_validation.bracket_identity_changes c
              left join jsonb_to_recordset(p_participants) as p(
                  participant_key text, display_name text, player_id uuid, registration_id uuid,
                  entry_id uuid, entry_participant_id uuid
              ) on p.entry_participant_id = c.entry_participant_id
             where c.bracket_runtime_id = p_runtime_id and p.entry_participant_id is null
        ) then
            raise exception using errcode = 'P0001', message = '동일 runtime_id의 payload가 기존 identity graph와 달라 retry를 거부했습니다.';
        end if;

        if exists (
            with input_slots as (
                select s.slot_no, s.entry_id
                  from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)
            )
            select stage_kind, stage_no, pool_no, slot_no, entry_id
              from ypl_schema_validation.bracket_entry_slots
             where bracket_runtime_id = p_runtime_id
            except
            select 'elimination'::text, 1::smallint, 0::smallint, slot_no, entry_id
              from input_slots
        ) or exists (
            with input_slots as (
                select s.slot_no, s.entry_id
                  from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)
            )
            select 'elimination'::text, 1::smallint, 0::smallint, slot_no, entry_id
              from input_slots
            except
            select stage_kind, stage_no, pool_no, slot_no, entry_id
              from ypl_schema_validation.bracket_entry_slots
             where bracket_runtime_id = p_runtime_id
        ) then
            raise exception using errcode = 'P0001', message = '동일 runtime_id의 draw slot payload가 달라 retry를 거부했습니다.';
        end if;

        if exists (
            with expected_matches as (
                with slots as (
                    select slot_no, entry_id from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)
                )
                select 'single:r1:m' || m.match_no::text AS source_node_key,
                       'bracket'::text AS match_kind, 1::smallint AS round_number,
                       m.match_no AS sequence_no, a.entry_id AS entry_a_id,
                       b.entry_id AS entry_b_id, 'unknown'::text AS resolution
                  from generate_series(1, v_bracket_size / 2) as m(match_no)
                  join slots a on a.slot_no = (m.match_no * 2) - 1
                  join slots b on b.slot_no = m.match_no * 2
            )
            select source_node_key, match_kind, round_number, sequence_no, entry_a_id, entry_b_id, resolution
              from ypl_schema_validation.matches as m0
             where m0.event_id = p_event_id and m0.source = 'normalized_bracket_runtime'
            except
            select source_node_key, match_kind, round_number, sequence_no, entry_a_id, entry_b_id, resolution
              from expected_matches
        ) or exists (
            with expected_matches as (
                with slots as (
                    select slot_no, entry_id from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)
                )
                select 'single:r1:m' || m.match_no::text AS source_node_key,
                       'bracket'::text AS match_kind, 1::smallint AS round_number,
                       m.match_no AS sequence_no, a.entry_id AS entry_a_id,
                       b.entry_id AS entry_b_id, 'unknown'::text AS resolution
                  from generate_series(1, v_bracket_size / 2) as m(match_no)
                  join slots a on a.slot_no = (m.match_no * 2) - 1
                  join slots b on b.slot_no = m.match_no * 2
            )
            select source_node_key, match_kind, round_number, sequence_no, entry_a_id, entry_b_id, resolution
              from expected_matches
            except
            select source_node_key, match_kind, round_number, sequence_no, entry_a_id, entry_b_id, resolution
              from ypl_schema_validation.matches as m0
             where m0.event_id = p_event_id and m0.source = 'normalized_bracket_runtime'
        ) then
            raise exception using errcode = 'P0001', message = '동일 runtime_id의 Match payload가 달라 retry를 거부했습니다.';
        end if;

        select count(*)::integer into v_match_count
              from ypl_schema_validation.matches as m0
             where m0.event_id = p_event_id and m0.source = 'normalized_bracket_runtime';
        return query select p_runtime_id, p_event_id, v_participant_count, v_slot_count, v_match_count, false;
        return;
    end if;

    -- A new normalized runtime cannot be mixed with an existing normalized
    -- identity/match graph or a legacy Event-linked Match graph.
    if exists (select 1 from ypl_schema_validation.bracket_runtimes as br0 where br0.event_id = p_event_id)
       or exists (select 1 from ypl_schema_validation.entries as e0 where e0.event_id = p_event_id)
       or exists (select 1 from ypl_schema_validation.matches as m0 where m0.event_id = p_event_id)
       or exists (select 1 from ypl_schema_validation.results as r0 where r0.event_id = p_event_id)
       or exists (select 1 from ypl_schema_validation.ranking_awards as a0 where a0.event_id = p_event_id) then
        raise exception using errcode = 'P0001', message = '기존 normalized 또는 legacy Event-linked bracket과 충돌해 생성을 중단했습니다.';
    end if;

    -- The runtime parent must exist before identity rows because
    -- bracket_identity_changes has a same-Event FK to bracket_runtimes.
    insert into ypl_schema_validation.bracket_runtimes (
        id, event_id, topology_kind, projection_version,
        previous_event_status
    ) values (
        p_runtime_id, p_event_id, 'single_elimination', 1, v_event.status
    );

    for v_participant in
        select *
          from jsonb_to_recordset(p_participants) as p(
              participant_key text,
              display_name text,
              player_id uuid,
              registration_id uuid,
              entry_id uuid,
              entry_participant_id uuid
          )
         order by participant_key
    loop
        select * into v_player
          from ypl_schema_validation.players
         where id = v_participant.player_id;
        v_player_was_created := not found;
        if v_player_was_created then
            if exists (
                select 1
                  from ypl_schema_validation.players
                 where display_name = btrim(v_participant.display_name)
            ) then
                raise exception using errcode = 'P0001', message = '동일 display_name Player가 이미 존재해 새 identity를 만들 수 없습니다.';
            end if;
            insert into ypl_schema_validation.players (id, display_name, status)
            values (v_participant.player_id, btrim(v_participant.display_name), 'active');
        elsif v_player.display_name is distinct from btrim(v_participant.display_name) then
            raise exception using errcode = 'P0001', message = '기존 Player display_name이 participant payload와 다릅니다.';
        end if;

        select * into v_registration
          from ypl_schema_validation.event_registrations
         where id = v_participant.registration_id;
        v_registration_was_created := not found;
        v_registration_player_was_changed := false;
        v_previous_registration_player_id := null;
        if v_registration_was_created then
            if exists (
                select 1
                   from ypl_schema_validation.event_registrations as er0
                  where er0.event_id = p_event_id
                    and er0.registration_name = btrim(v_participant.display_name)
            ) then
                raise exception using errcode = 'P0001', message = '동일 이름의 Event Registration이 이미 존재합니다.';
            end if;
            insert into ypl_schema_validation.event_registrations (
                id, event_id, player_id, registration_name, registration_data,
                registration_source, registered_at, updated_at
            ) values (
                v_participant.registration_id, p_event_id, v_participant.player_id,
                btrim(v_participant.display_name), '{}'::jsonb, 'manual', now(), now()
            );
        else
            if v_registration.event_id is distinct from p_event_id
               or v_registration.registration_name is distinct from btrim(v_participant.display_name)
               or v_registration.registration_source is null
               or v_registration.registration_source = 'migration' then
                raise exception using errcode = 'P0001', message = 'Registration ownership 또는 이름이 participant payload와 다릅니다.';
            end if;
            if v_registration.player_id is null then
                update ypl_schema_validation.event_registrations as er
                   set player_id = v_participant.player_id, updated_at = now()
                 where er.id = v_participant.registration_id
                   and er.event_id = p_event_id
                   and er.player_id is null;
                v_registration_player_was_changed := true;
            elsif v_registration.player_id is distinct from v_participant.player_id then
                raise exception using errcode = 'P0001', message = 'Registration이 다른 Player에 이미 연결되어 있습니다.';
            end if;
        end if;

        select * into v_entry
          from ypl_schema_validation.entries
         where id = v_participant.entry_id;
        v_entry_was_created := not found;
        if v_entry_was_created then
            insert into ypl_schema_validation.entries (
                id, event_id, entry_type, display_name, status
            ) values (
                v_participant.entry_id, p_event_id, 'individual',
                btrim(v_participant.display_name), 'active'
            );
        elsif v_entry.event_id is distinct from p_event_id
           or v_entry.entry_type is distinct from 'individual'
           or v_entry.status is distinct from 'active'
           or v_entry.display_name is distinct from btrim(v_participant.display_name) then
            raise exception using errcode = 'P0001', message = 'Entry ownership이 participant payload와 다릅니다.';
        end if;

        select * into v_entry_participant
          from ypl_schema_validation.entry_participants
         where id = v_participant.entry_participant_id;
        v_entry_participant_was_created := not found;
        if v_entry_participant_was_created then
            insert into ypl_schema_validation.entry_participants (
                id, event_id, entry_id, registration_id, player_id, member_order
            ) values (
                v_participant.entry_participant_id, p_event_id, v_participant.entry_id,
                v_participant.registration_id, v_participant.player_id, 1
            );
        elsif v_entry_participant.event_id is distinct from p_event_id
           or v_entry_participant.entry_id is distinct from v_participant.entry_id
           or v_entry_participant.registration_id is distinct from v_participant.registration_id
           or v_entry_participant.player_id is distinct from v_participant.player_id
           or v_entry_participant.member_order is distinct from 1 then
            raise exception using errcode = 'P0001', message = 'EntryParticipant ownership이 participant payload와 다릅니다.';
        end if;

        insert into ypl_schema_validation.bracket_identity_changes (
            bracket_runtime_id, event_id, entry_participant_id, entry_id,
            registration_id, player_id, player_was_created,
            registration_was_created, registration_player_was_changed,
            previous_registration_player_id, entry_was_created,
            entry_participant_was_created
        ) values (
            p_runtime_id, p_event_id, v_participant.entry_participant_id,
            v_participant.entry_id, v_participant.registration_id,
            v_participant.player_id, v_player_was_created,
            v_registration_was_created, v_registration_player_was_changed,
            v_previous_registration_player_id, v_entry_was_created,
            v_entry_participant_was_created
        );
    end loop;

    insert into ypl_schema_validation.bracket_entry_slots (
        bracket_runtime_id, event_id, stage_kind, stage_no,
        pool_no, slot_no, entry_id
    )
    select p_runtime_id, p_event_id, 'elimination', 1, 0, s.slot_no, s.entry_id
      from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid);

    with slots as (
        select slot_no, entry_id from jsonb_to_recordset(p_slots) as s(slot_no integer, entry_id uuid)
    )
    insert into ypl_schema_validation.matches (
        event_id, match_kind, round_number, stage_label, sequence_no,
        entry_a_id, entry_b_id, resolution, source, source_node_key
    )
    select p_event_id, 'bracket', 1, '본선 1R', m.match_no,
           a.entry_id, b.entry_id, 'unknown', 'normalized_bracket_runtime',
           'single:r1:m' || m.match_no::text
      from generate_series(1, v_bracket_size / 2) as m(match_no)
      join slots a on a.slot_no = (m.match_no * 2) - 1
      join slots b on b.slot_no = m.match_no * 2;
    get diagnostics v_match_count = row_count;

    update ypl_schema_validation.events
       set status = 'running', updated_at = now()
     where id = p_event_id;

    return query select p_runtime_id, p_event_id, v_participant_count,
                        v_slot_count, v_match_count, true;
end;
$$;


-- =========================================================
-- DELETE
-- =========================================================

create or replace function ypl_schema_validation.delete_normalized_single_bracket_runtime(
    p_runtime_id uuid,
    p_event_id uuid
)
returns table (
    runtime_id uuid,
    event_id uuid,
    deleted_match_count integer,
    deleted_slot_count integer,
    deleted_identity_count integer,
    restored_event_status text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_event ypl_schema_validation.events%rowtype;
    v_runtime ypl_schema_validation.bracket_runtimes%rowtype;
    v_change record;
    v_identity_snapshot jsonb;
    v_identity_count integer;
    v_deleted_matches integer := 0;
    v_deleted_slots integer := 0;
    v_deleted_identities integer := 0;
    v_deleted integer;
    v_bracket_size integer := 1;
    v_expected_match_count integer := 0;
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
    if v_event.is_team_event
       or v_event.competition_format <> 'single_elimination'
       or v_event.record_applied_at is not null
       or v_event.status = 'completed'
       or v_event.status not in ('open', 'running') then
        raise exception using errcode = 'P0001', message = '기록 반영 전 open/running 개인전만 삭제할 수 있습니다.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('normalized-single-runtime:' || p_runtime_id::text, 0));
    select * into v_runtime
      from ypl_schema_validation.bracket_runtimes as br
     where br.id = p_runtime_id and br.event_id = p_event_id
     ;
    if not found then
        raise exception using errcode = 'P0001', message = 'normalized Single runtime을 찾을 수 없습니다.';
    end if;
    if v_runtime.topology_kind <> 'single_elimination' or v_runtime.projection_version <> 1 then
        raise exception using errcode = 'P0001', message = '삭제 대상 runtime topology/version이 일치하지 않습니다.';
    end if;

    if exists (select 1 from ypl_schema_validation.results as r0 where r0.event_id = p_event_id)
       or exists (select 1 from ypl_schema_validation.ranking_awards as a0 where a0.event_id = p_event_id) then
        raise exception using errcode = 'P0001', message = 'Result 또는 RankingAward가 있어 삭제를 중단했습니다.';
    end if;
    if exists (
        select 1
          from ypl_schema_validation.matches as m0
         where m0.event_id = p_event_id
           and m0.source <> 'normalized_bracket_runtime'
    ) then
        raise exception using errcode = 'P0001', message = '다른 source가 소유한 Match가 있어 삭제를 중단했습니다.';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'entry_participant_id', entry_participant_id,
        'entry_id', entry_id,
        'registration_id', registration_id,
        'player_id', player_id,
        'player_was_created', player_was_created,
        'registration_was_created', registration_was_created,
        'registration_player_was_changed', registration_player_was_changed,
        'previous_registration_player_id', previous_registration_player_id,
        'entry_was_created', entry_was_created,
        'entry_participant_was_created', entry_participant_was_created
    ) order by entry_participant_id), '[]'::jsonb)
      into v_identity_snapshot
       from ypl_schema_validation.bracket_identity_changes as bic
      where bic.bracket_runtime_id = p_runtime_id and bic.event_id = p_event_id;

    select jsonb_array_length(v_identity_snapshot) into v_identity_count;
    if v_identity_count < 2 then
        raise exception using errcode = 'P0001', message = 'ownership metadata가 없거나 참가자 수가 부족합니다.';
    end if;
    if exists (
        select 1
          from jsonb_to_recordset(v_identity_snapshot) as c(
              entry_participant_id uuid, entry_id uuid, registration_id uuid,
              player_id uuid, player_was_created boolean,
              registration_was_created boolean, registration_player_was_changed boolean,
              previous_registration_player_id uuid, entry_was_created boolean,
              entry_participant_was_created boolean
          )
         where not c.entry_was_created or not c.entry_participant_was_created
    ) then
        raise exception using errcode = 'P0001', message = '현재 Single runtime이 소유하지 않은 Entry identity가 있어 삭제를 중단했습니다.';
    end if;
    if (select count(*) from ypl_schema_validation.entries as e0 where e0.event_id = p_event_id) <> v_identity_count
       or (select count(*) from ypl_schema_validation.entry_participants as ep0 where ep0.event_id = p_event_id) <> v_identity_count
       or (select count(*) from ypl_schema_validation.bracket_entry_slots as bes0 where bes0.bracket_runtime_id = p_runtime_id) <> v_identity_count then
        raise exception using errcode = 'P0001', message = 'runtime/slot/identity count가 exact ownership과 일치하지 않습니다.';
    end if;
    while v_bracket_size < v_identity_count loop
        v_bracket_size := v_bracket_size * 2;
    end loop;
    if exists (
        select 1
          from ypl_schema_validation.bracket_entry_slots s
         where s.bracket_runtime_id = p_runtime_id
           and s.event_id = p_event_id
           and (s.stage_kind <> 'elimination'
             or s.stage_no <> 1
             or s.pool_no <> 0
             or s.slot_no < 1
             or s.slot_no > v_bracket_size
             or not exists (
                 select 1
                   from jsonb_to_recordset(v_identity_snapshot) as c(
                       entry_participant_id uuid, entry_id uuid, registration_id uuid,
                       player_id uuid, player_was_created boolean,
                       registration_was_created boolean, registration_player_was_changed boolean,
                       previous_registration_player_id uuid, entry_was_created boolean,
                       entry_participant_was_created boolean
                   )
                  where c.entry_id = s.entry_id
             ))
    ) then
        raise exception using errcode = 'P0001', message = 'draw slot이 initial Single ownership과 일치하지 않습니다.';
    end if;
    if exists (
        select 1
          from jsonb_to_recordset(v_identity_snapshot) as c(
              entry_participant_id uuid, entry_id uuid, registration_id uuid,
              player_id uuid, player_was_created boolean,
              registration_was_created boolean, registration_player_was_changed boolean,
              previous_registration_player_id uuid, entry_was_created boolean,
              entry_participant_was_created boolean
          )
          left join ypl_schema_validation.bracket_entry_slots s
            on s.bracket_runtime_id = p_runtime_id
           and s.event_id = p_event_id
           and s.stage_kind = 'elimination'
           and s.stage_no = 1
           and s.pool_no = 0
           and s.entry_id = c.entry_id
         where s.entry_id is null
    ) then
        raise exception using errcode = 'P0001', message = 'ownership Entry에 initial draw slot이 없습니다.';
    end if;
    if exists (
        select 1
          from ypl_schema_validation.bracket_identity_changes c
          left join ypl_schema_validation.entries e
            on e.id = c.entry_id and e.event_id = p_event_id
          left join ypl_schema_validation.entry_participants ep
            on ep.id = c.entry_participant_id and ep.event_id = p_event_id
          left join ypl_schema_validation.event_registrations r
            on r.id = c.registration_id and r.event_id = p_event_id
          left join ypl_schema_validation.players p on p.id = c.player_id
         where c.bracket_runtime_id = p_runtime_id
           and (e.id is null or e.entry_type <> 'individual' or e.status <> 'active'
             or ep.entry_id is distinct from c.entry_id
             or ep.registration_id is distinct from c.registration_id
             or ep.player_id is distinct from c.player_id
             or ep.member_order is distinct from 1::smallint
             or r.player_id is distinct from c.player_id or p.id is null)
    ) then
        raise exception using errcode = 'P0001', message = 'ownership metadata와 현재 Entry/Registration/Player가 exact-match하지 않습니다.';
    end if;
    if exists (
        select 1
          from ypl_schema_validation.event_registrations r
          join ypl_schema_validation.bracket_identity_changes c
            on c.bracket_runtime_id = p_runtime_id and c.registration_id = r.id
         where r.final_submission_id is not null
            or exists (select 1 from ypl_schema_validation.registration_submissions s where s.registration_id = r.id)
    ) then
        raise exception using errcode = 'P0001', message = 'Submission/history가 연결된 Registration은 자동 삭제할 수 없습니다.';
    end if;
    if exists (
        select 1
          from ypl_schema_validation.matches as m0
          where m0.event_id = p_event_id
             and (m0.source <> 'normalized_bracket_runtime'
               or m0.match_kind is distinct from 'bracket'
               or m0.parent_match_id is not null
               or m0.round_number is null or m0.round_number < 1
               or m0.source_node_key is null
               or m0.source_node_key !~ '^single:r[1-9][0-9]*:m[1-9][0-9]*$'
               or m0.entry_a_id is null or m0.entry_b_id is null
               or m0.player_a_id is not null or m0.player_b_id is not null
               or m0.winner_player_id is not null
               or (m0.winner_entry_id is not null
                   and m0.winner_entry_id not in (m0.entry_a_id, m0.entry_b_id))
               or not exists (
                   select 1 from ypl_schema_validation.bracket_identity_changes c0
                    where c0.bracket_runtime_id = p_runtime_id
                      and c0.event_id = p_event_id
                      and c0.entry_id = m0.entry_a_id)
               or not exists (
                   select 1 from ypl_schema_validation.bracket_identity_changes c1
                    where c1.bracket_runtime_id = p_runtime_id
                      and c1.event_id = p_event_id
                      and c1.entry_id = m0.entry_b_id))
    ) then
        raise exception using errcode = 'P0001', message = 'runtime Match shape가 Single canonical Match contract와 다릅니다.';
    end if;

    -- Snapshot ownership before deleting the FK parent metadata.
    delete from ypl_schema_validation.matches as m0
     where m0.event_id = p_event_id and m0.source = 'normalized_bracket_runtime';
    get diagnostics v_deleted_matches = row_count;

    delete from ypl_schema_validation.bracket_entry_slots as bes0
     where bes0.bracket_runtime_id = p_runtime_id and bes0.event_id = p_event_id;
    get diagnostics v_deleted_slots = row_count;

    delete from ypl_schema_validation.bracket_identity_changes as bic0
     where bic0.bracket_runtime_id = p_runtime_id and bic0.event_id = p_event_id;
    get diagnostics v_deleted_identities = row_count;
    if v_deleted_identities <> v_identity_count then
        raise exception using errcode = 'P0001', message = 'ownership metadata 삭제 수가 예상과 다릅니다.';
    end if;

    for v_change in
        select *
          from jsonb_to_recordset(v_identity_snapshot) as c(
              entry_participant_id uuid, entry_id uuid, registration_id uuid,
              player_id uuid, player_was_created boolean,
              registration_was_created boolean, registration_player_was_changed boolean,
              previous_registration_player_id uuid, entry_was_created boolean,
              entry_participant_was_created boolean
          )
    loop
        delete from ypl_schema_validation.entry_participants as ep0
         where id = v_change.entry_participant_id
           and ep0.event_id = p_event_id
           and ep0.entry_id = v_change.entry_id
           and ep0.registration_id = v_change.registration_id
           and ep0.player_id = v_change.player_id;
        get diagnostics v_deleted = row_count;
        if v_deleted <> 1 then
            raise exception using errcode = 'P0001', message = 'EntryParticipant exact deletion ownership이 일치하지 않습니다.';
        end if;
    end loop;

    for v_change in
        select *
          from jsonb_to_recordset(v_identity_snapshot) as c(
              entry_participant_id uuid, entry_id uuid, registration_id uuid,
              player_id uuid, player_was_created boolean,
              registration_was_created boolean, registration_player_was_changed boolean,
              previous_registration_player_id uuid, entry_was_created boolean,
              entry_participant_was_created boolean
          )
    loop
        if v_change.entry_was_created then
            delete from ypl_schema_validation.entries as e0
             where e0.id = v_change.entry_id
               and e0.event_id = p_event_id;
            get diagnostics v_deleted = row_count;
            if v_deleted <> 1 then
                raise exception using errcode = 'P0001', message = 'Entry exact deletion ownership이 일치하지 않습니다.';
            end if;
        end if;
    end loop;

    for v_change in
        select *
          from jsonb_to_recordset(v_identity_snapshot) as c(
              entry_participant_id uuid, entry_id uuid, registration_id uuid,
              player_id uuid, player_was_created boolean,
              registration_was_created boolean, registration_player_was_changed boolean,
              previous_registration_player_id uuid, entry_was_created boolean,
              entry_participant_was_created boolean
          )
    loop
        if v_change.registration_was_created then
            delete from ypl_schema_validation.event_registrations as er0
             where er0.id = v_change.registration_id
               and er0.event_id = p_event_id
               and er0.player_id = v_change.player_id;
            get diagnostics v_deleted = row_count;
            if v_deleted <> 1 then
                raise exception using errcode = 'P0001', message = 'Registration 삭제 ownership이 일치하지 않습니다.';
            end if;
        elsif v_change.registration_player_was_changed then
            update ypl_schema_validation.event_registrations as er0
               set player_id = v_change.previous_registration_player_id,
                   updated_at = now()
             where er0.id = v_change.registration_id
               and er0.event_id = p_event_id
               and er0.player_id = v_change.player_id;
            get diagnostics v_deleted = row_count;
            if v_deleted <> 1 then
                raise exception using errcode = 'P0001', message = 'Registration restore ownership이 일치하지 않습니다.';
            end if;
        end if;
    end loop;

    for v_change in
        select *
          from jsonb_to_recordset(v_identity_snapshot) as c(
              entry_participant_id uuid, entry_id uuid, registration_id uuid,
              player_id uuid, player_was_created boolean,
              registration_was_created boolean, registration_player_was_changed boolean,
              previous_registration_player_id uuid, entry_was_created boolean,
              entry_participant_was_created boolean
          )
    loop
        if v_change.player_was_created then
            delete from ypl_schema_validation.players as p0
             where p0.id = v_change.player_id;
            get diagnostics v_deleted = row_count;
            if v_deleted <> 1 then
                raise exception using errcode = 'P0001', message = '생성된 Player exact deletion ownership이 일치하지 않습니다.';
            end if;
        end if;
    end loop;

    delete from ypl_schema_validation.bracket_runtimes as br0
     where br0.id = p_runtime_id and br0.event_id = p_event_id;
    get diagnostics v_deleted = row_count;
    if v_deleted <> 1 then
        raise exception using errcode = 'P0001', message = 'runtime exact deletion ownership이 일치하지 않습니다.';
    end if;

    update ypl_schema_validation.events
       set status = v_runtime.previous_event_status, updated_at = now()
     where id = p_event_id;
    get diagnostics v_deleted = row_count;
    if v_deleted <> 1 then
        raise exception using errcode = 'P0001', message = 'Event previous status 복구에 실패했습니다.';
    end if;

    return query select p_runtime_id, p_event_id, v_deleted_matches,
                        v_deleted_slots, v_deleted_identities,
                        v_runtime.previous_event_status;
end;
$$;


-- SECURITY INVOKER functions must not inherit PUBLIC EXECUTE. Only the
-- existing Test anon client is allowed to call these drafts. No grants are
-- given to authenticated or service_role here.
revoke all on function ypl_schema_validation.create_normalized_single_bracket_runtime(uuid, uuid, jsonb, jsonb) from public;
revoke all on function ypl_schema_validation.create_normalized_single_bracket_runtime(uuid, uuid, jsonb, jsonb) from authenticated, service_role;
grant execute on function ypl_schema_validation.create_normalized_single_bracket_runtime(uuid, uuid, jsonb, jsonb) to anon;

revoke all on function ypl_schema_validation.delete_normalized_single_bracket_runtime(uuid, uuid) from public;
revoke all on function ypl_schema_validation.delete_normalized_single_bracket_runtime(uuid, uuid) from authenticated, service_role;
grant execute on function ypl_schema_validation.delete_normalized_single_bracket_runtime(uuid, uuid) to anon;
