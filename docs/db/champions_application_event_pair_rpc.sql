-- Champions application notice Event-pair lifecycle.
-- Test schema only. Do not apply to Production.

create or replace function ypl_schema_validation.save_championship_application_event_pair(
    p_qualifier_event_id uuid,
    p_final_event_id uuid,
    p_season_id uuid,
    p_announcement_id text,
    p_base_name text,
    p_round_number integer,
    p_battle_format text,
    p_generation integer,
    p_final_capacity integer,
    p_qualification_slots integer,
    p_regulation_id text,
    p_cup_rule_id text,
    p_cup_rule_settings jsonb,
    p_registration_settings jsonb,
    p_competition_settings jsonb,
    p_held_on date,
    p_submission_target_at timestamptz
)
returns table (
    qualifier_event_id uuid,
    final_event_id uuid,
    created boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_qualifier ypl_schema_validation.events%rowtype;
    v_final ypl_schema_validation.events%rowtype;
    v_qualifier_exists boolean := false;
    v_final_exists boolean := false;
    v_settings jsonb;
    v_qualifier_registration_settings jsonb;
    v_critical_changed boolean := false;
begin
    if p_qualifier_event_id is null or p_final_event_id is null
       or p_qualifier_event_id = p_final_event_id or p_season_id is null
       or nullif(btrim(coalesce(p_announcement_id, '')), '') is null
       or nullif(btrim(coalesce(p_base_name, '')), '') is null then
        raise exception using errcode = 'P0001', message = 'Champions 공지와 Event pair identity가 필요합니다.';
    end if;
    if p_battle_format not in ('singles', 'doubles') then
        raise exception using errcode = 'P0001', message = 'Champions battle_format은 singles 또는 doubles여야 합니다.';
    end if;
    if p_generation is null or p_generation < 1
       or p_final_capacity is null or p_final_capacity < 2
       or p_qualification_slots is null or p_qualification_slots < 1
       or p_qualification_slots > p_final_capacity then
        raise exception using errcode = 'P0001', message = 'generation, final capacity, qualification slots가 올바르지 않습니다.';
    end if;
    if p_round_number is not null and p_round_number < 1 then
        raise exception using errcode = 'P0001', message = '회차 번호는 1 이상이어야 합니다.';
    end if;
    if not exists (select 1 from ypl_schema_validation.seasons s where s.id = p_season_id) then
        raise exception using errcode = 'P0001', message = 'Champions Event에 연결할 Season이 없습니다.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('championship-pair:' || p_qualifier_event_id::text, 0));
    perform pg_advisory_xact_lock(hashtextextended('championship-pair:' || p_final_event_id::text, 0));

    select * into v_qualifier from ypl_schema_validation.events e where e.id = p_qualifier_event_id for update;
    v_qualifier_exists := found;
    select * into v_final from ypl_schema_validation.events e where e.id = p_final_event_id for update;
    v_final_exists := found;

    if v_qualifier_exists <> v_final_exists then
        raise exception using errcode = 'P0001', message = 'Champions Event pair가 부분 생성 상태라 저장을 중단했습니다.';
    end if;

    v_settings := coalesce(p_competition_settings, '{}'::jsonb)
      || jsonb_build_object(
           'championship', jsonb_build_object(
             'generation', p_generation,
             'finalCapacity', p_final_capacity
           )
         );
    v_qualifier_registration_settings := coalesce(p_registration_settings, '{}'::jsonb)
      || jsonb_build_object('announcementId', btrim(p_announcement_id));

    if not v_qualifier_exists then
        insert into ypl_schema_validation.events (
            id, season_id, name, round_number, event_type, division,
            battle_format, competition_format, competition_settings, is_team_event,
            regulation_id, cup_rule_id, cup_rule_settings, registration_settings,
            held_on, date_precision, status, submission_target_at,
            championship_phase, championship_final_event_id, qualification_slots
        ) values (
            p_final_event_id, p_season_id, btrim(p_base_name) || ' · 본선', p_round_number,
            'champions', null, p_battle_format, 'single_elimination', v_settings, false,
            p_regulation_id, p_cup_rule_id, coalesce(p_cup_rule_settings, '{}'::jsonb), '{}'::jsonb,
            p_held_on, case when p_held_on is null then 'unknown' else 'exact' end, 'open', p_submission_target_at,
            'final', null, null
        );
        insert into ypl_schema_validation.events (
            id, season_id, name, round_number, event_type, division,
            battle_format, competition_format, competition_settings, is_team_event,
            regulation_id, cup_rule_id, cup_rule_settings, registration_settings,
            held_on, date_precision, status, submission_target_at,
            championship_phase, championship_final_event_id, qualification_slots
        ) values (
            p_qualifier_event_id, p_season_id, btrim(p_base_name) || ' · 선발전', p_round_number,
            'champions', null, p_battle_format, 'double_elimination', v_settings, false,
            p_regulation_id, p_cup_rule_id, coalesce(p_cup_rule_settings, '{}'::jsonb), v_qualifier_registration_settings,
            p_held_on, case when p_held_on is null then 'unknown' else 'exact' end, 'open', p_submission_target_at,
            'qualifier', p_final_event_id, p_qualification_slots
        );
        return query select p_qualifier_event_id, p_final_event_id, true;
        return;
    end if;

    if v_qualifier.event_type <> 'champions' or v_qualifier.championship_phase <> 'qualifier'
       or v_qualifier.championship_final_event_id <> p_final_event_id
       or v_final.event_type <> 'champions' or v_final.championship_phase <> 'final'
       or v_final.championship_final_event_id is not null then
        raise exception using errcode = 'P0001', message = '기존 Champions Qualifier/Final relation이 canonical pair와 다릅니다.';
    end if;

    v_critical_changed :=
        v_qualifier.battle_format is distinct from p_battle_format
        or v_final.battle_format is distinct from p_battle_format
        or v_qualifier.competition_format is distinct from 'double_elimination'
        or v_final.competition_format is distinct from 'single_elimination'
        or v_qualifier.qualification_slots is distinct from p_qualification_slots
        or (v_qualifier.competition_settings #>> '{championship,generation}')::integer is distinct from p_generation
        or (v_final.competition_settings #>> '{championship,generation}')::integer is distinct from p_generation
        or (v_final.competition_settings #>> '{championship,finalCapacity}')::integer is distinct from p_final_capacity;

    if v_critical_changed and (
        v_qualifier.status <> 'open' or v_final.status <> 'open'
        or exists (select 1 from ypl_schema_validation.event_registrations r where r.event_id in (p_qualifier_event_id, p_final_event_id))
        or exists (select 1 from ypl_schema_validation.entries e where e.event_id in (p_qualifier_event_id, p_final_event_id))
        or exists (select 1 from ypl_schema_validation.matches m where m.event_id in (p_qualifier_event_id, p_final_event_id))
        or exists (select 1 from ypl_schema_validation.bracket_runtimes br where br.event_id in (p_qualifier_event_id, p_final_event_id))
        or exists (
            select 1 from ypl_schema_validation.championship_advancements ca
            join ypl_schema_validation.event_registrations r on r.id = ca.final_registration_id
            where r.event_id = p_final_event_id
        )
    ) then
        raise exception using errcode = 'P0001', message = '참가/대진 runtime이 시작된 Champions pair의 핵심 설정은 수정할 수 없습니다.';
    end if;

    update ypl_schema_validation.events e set
        season_id = p_season_id,
        name = btrim(p_base_name) || ' · 본선',
        round_number = p_round_number,
        division = null,
        battle_format = p_battle_format,
        competition_format = 'single_elimination',
        competition_settings = v_settings,
        is_team_event = false,
        regulation_id = p_regulation_id,
        cup_rule_id = p_cup_rule_id,
        cup_rule_settings = coalesce(p_cup_rule_settings, '{}'::jsonb),
        held_on = p_held_on,
        date_precision = case when p_held_on is null then 'unknown' else 'exact' end,
        submission_target_at = p_submission_target_at,
        updated_at = now()
    where e.id = p_final_event_id;

    update ypl_schema_validation.events e set
        season_id = p_season_id,
        name = btrim(p_base_name) || ' · 선발전',
        round_number = p_round_number,
        division = null,
        battle_format = p_battle_format,
        competition_format = 'double_elimination',
        competition_settings = v_settings,
        is_team_event = false,
        regulation_id = p_regulation_id,
        cup_rule_id = p_cup_rule_id,
        cup_rule_settings = coalesce(p_cup_rule_settings, '{}'::jsonb),
        registration_settings = v_qualifier_registration_settings,
        held_on = p_held_on,
        date_precision = case when p_held_on is null then 'unknown' else 'exact' end,
        submission_target_at = p_submission_target_at,
        updated_at = now()
    where e.id = p_qualifier_event_id;

    return query select p_qualifier_event_id, p_final_event_id, false;
end;
$$;

create or replace function ypl_schema_validation.create_championship_advancement(
    p_advancement_id uuid,
    p_registration_id uuid,
    p_final_event_id uuid,
    p_player_id uuid,
    p_advancement_type text,
    p_source_entry_id uuid,
    p_reason text
)
returns table (advancement_id uuid, registration_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_final ypl_schema_validation.events%rowtype;
    v_qualifier ypl_schema_validation.events%rowtype;
    v_player ypl_schema_validation.players%rowtype;
    v_capacity integer;
    v_generation integer;
    v_count integer;
begin
    if p_advancement_id is null or p_registration_id is null
       or p_final_event_id is null or p_player_id is null
       or p_advancement_type not in ('ranking', 'qualifier', 'manual') then
        raise exception using errcode = 'P0001', message = 'Champions advancement identity와 source가 필요합니다.';
    end if;
    if (p_advancement_type = 'qualifier') <> (p_source_entry_id is not null) then
        raise exception using errcode = 'P0001', message = 'qualifier advancement만 source Entry를 가져야 합니다.';
    end if;

    select * into v_final from ypl_schema_validation.events e
     where e.id = p_final_event_id for update;
    if not found or v_final.event_type <> 'champions'
       or v_final.championship_phase <> 'final'
       or v_final.competition_format <> 'single_elimination'
       or v_final.status <> 'open' or v_final.record_applied_at is not null then
        raise exception using errcode = 'P0001', message = '현재 Final Event에는 advancement를 만들 수 없습니다.';
    end if;
    select * into v_player from ypl_schema_validation.players p
     where p.id = p_player_id and p.status <> 'inactive';
    if not found then
        raise exception using errcode = 'P0001', message = 'advancement Player를 찾을 수 없습니다.';
    end if;

    v_capacity := (v_final.competition_settings #>> '{championship,finalCapacity}')::integer;
    v_generation := (v_final.competition_settings #>> '{championship,generation}')::integer;
    if v_capacity is null or v_capacity < 2 or v_generation is null or v_generation < 1 then
        raise exception using errcode = 'P0001', message = 'Final capacity 또는 generation 설정이 없습니다.';
    end if;
    select count(*)::integer into v_count
      from ypl_schema_validation.championship_advancements ca
      join ypl_schema_validation.event_registrations r on r.id = ca.final_registration_id
     where r.event_id = p_final_event_id;
    if v_count >= v_capacity then
        raise exception using errcode = 'P0001', message = '본선 정원이 모두 확정되었습니다.';
    end if;
    if exists (select 1 from ypl_schema_validation.event_registrations r where r.event_id = p_final_event_id and r.player_id = p_player_id) then
        raise exception using errcode = 'P0001', message = '이미 본선에 등록된 Player입니다.';
    end if;

    if p_advancement_type = 'qualifier' then
        select * into v_qualifier from ypl_schema_validation.events e
         where e.championship_final_event_id = p_final_event_id
           and e.event_type = 'champions' and e.championship_phase = 'qualifier';
        if not found then
            raise exception using errcode = 'P0001', message = '연결된 Qualifier Event를 찾을 수 없습니다.';
        end if;
        if not exists (
            select 1 from ypl_schema_validation.entries e
            join ypl_schema_validation.entry_participants ep on ep.entry_id = e.id and ep.event_id = e.event_id
            where e.id = p_source_entry_id and e.event_id = v_qualifier.id
              and e.entry_type = 'individual' and e.status = 'active'
              and ep.player_id = p_player_id and ep.member_order = 1
        ) then
            raise exception using errcode = 'P0001', message = 'Qualifier Entry와 Player identity가 일치하지 않습니다.';
        end if;
        select count(*)::integer into v_count
          from ypl_schema_validation.championship_advancements ca
          join ypl_schema_validation.event_registrations r on r.id = ca.final_registration_id
         where r.event_id = p_final_event_id and ca.advancement_type = 'qualifier';
        if v_count >= v_qualifier.qualification_slots then
            raise exception using errcode = 'P0001', message = 'Qualifier 진출 인원이 이미 모두 확정되었습니다.';
        end if;
    end if;

    insert into ypl_schema_validation.event_registrations (
        id, event_id, player_id, registration_name, registration_data,
        registration_source, registered_at, updated_at
    ) values (
        p_registration_id, p_final_event_id, p_player_id, v_player.display_name,
        jsonb_build_object('champions', jsonb_build_object(
            'generation', v_generation,
            'source', p_advancement_type,
            'reason', nullif(btrim(coalesce(p_reason, '')), '')
        )),
        'advancement', now(), now()
    );
    insert into ypl_schema_validation.championship_advancements (
        id, final_registration_id, source_entry_id, advancement_type, reason
    ) values (
        p_advancement_id, p_registration_id, p_source_entry_id,
        p_advancement_type, nullif(btrim(coalesce(p_reason, '')), '')
    );
    return query select p_advancement_id, p_registration_id;
end;
$$;

create or replace function ypl_schema_validation.cancel_championship_advancement(
    p_advancement_id uuid
)
returns table (advancement_id uuid, registration_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_advancement ypl_schema_validation.championship_advancements%rowtype;
    v_registration ypl_schema_validation.event_registrations%rowtype;
    v_final ypl_schema_validation.events%rowtype;
begin
    select * into v_advancement from ypl_schema_validation.championship_advancements ca
     where ca.id = p_advancement_id for update;
    if not found then
        raise exception using errcode = 'P0001', message = '취소할 advancement를 찾을 수 없습니다.';
    end if;
    select * into v_registration from ypl_schema_validation.event_registrations r
     where r.id = v_advancement.final_registration_id for update;
    select * into v_final from ypl_schema_validation.events e
     where e.id = v_registration.event_id for update;
    if v_registration.registration_source <> 'advancement'
       or v_final.event_type <> 'champions' or v_final.championship_phase <> 'final'
       or v_final.status = 'completed' or v_final.record_applied_at is not null then
        raise exception using errcode = 'P0001', message = '완료됐거나 소유권이 다른 advancement는 취소할 수 없습니다.';
    end if;
    if exists (select 1 from ypl_schema_validation.registration_submissions s where s.registration_id = v_registration.id)
       or exists (select 1 from ypl_schema_validation.entry_participants ep where ep.registration_id = v_registration.id)
       or exists (select 1 from ypl_schema_validation.entries e where e.event_id = v_final.id)
       or exists (select 1 from ypl_schema_validation.matches m where m.event_id = v_final.id)
       or exists (select 1 from ypl_schema_validation.results r where r.event_id = v_final.id)
       or exists (select 1 from ypl_schema_validation.ranking_awards a where a.event_id = v_final.id)
       or exists (select 1 from ypl_schema_validation.bracket_runtimes br where br.event_id = v_final.id) then
        raise exception using errcode = 'P0001', message = '후속 사실이 있어 advancement 취소를 중단했습니다.';
    end if;
    delete from ypl_schema_validation.championship_advancements ca where ca.id = v_advancement.id;
    delete from ypl_schema_validation.event_registrations r where r.id = v_registration.id;
    return query select v_advancement.id, v_registration.id;
end;
$$;

create or replace function ypl_schema_validation.ensure_championship_final_hall_of_fame(
    p_event_id uuid,
    p_hall_of_fame_id uuid
)
returns table (hall_of_fame_id uuid, result_id uuid, player_id uuid, generation_number integer, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_event ypl_schema_validation.events%rowtype;
    v_existing ypl_schema_validation.hall_of_fame_entries%rowtype;
    v_result ypl_schema_validation.results%rowtype;
    v_player_id uuid;
    v_generation integer;
    v_count integer;
begin
    select * into v_event from ypl_schema_validation.events e where e.id = p_event_id for update;
    if not found or v_event.event_type <> 'champions'
       or v_event.championship_phase <> 'final'
       or v_event.status <> 'completed' or v_event.record_applied_at is null then
        raise exception using errcode = 'P0001', message = '공식 완료된 Champions Final만 Hall of Fame에 등록할 수 있습니다.';
    end if;
    v_generation := (v_event.competition_settings #>> '{championship,generation}')::integer;
    if v_generation is null or v_generation < 1 then
        raise exception using errcode = 'P0001', message = 'Final Event의 Champions generation 설정이 없습니다.';
    end if;
    select * into v_existing from ypl_schema_validation.hall_of_fame_entries h where h.event_id = p_event_id;
    if found then
        return query select v_existing.id, v_existing.result_id, v_existing.player_id, v_existing.generation_number, false;
        return;
    end if;
    if p_hall_of_fame_id is null then
        raise exception using errcode = 'P0001', message = 'Hall of Fame identity가 필요합니다.';
    end if;
    select count(*)::integer into v_count from ypl_schema_validation.results r
     where r.event_id = p_event_id and r.placement_code = 'champion';
    if v_count <> 1 then
        raise exception using errcode = 'P0001', message = 'Final champion Result가 정확히 1건이어야 합니다.';
    end if;
    select * into v_result from ypl_schema_validation.results r
     where r.event_id = p_event_id and r.placement_code = 'champion';
    select count(*)::integer into v_count from ypl_schema_validation.entry_participants ep
     where ep.event_id = p_event_id and ep.entry_id = v_result.entry_id;
    select ep.player_id into v_player_id from ypl_schema_validation.entry_participants ep
     where ep.event_id = p_event_id and ep.entry_id = v_result.entry_id limit 1;
    if v_count <> 1 or v_player_id is null then
        raise exception using errcode = 'P0001', message = 'Final champion Player identity가 정확히 1건이어야 합니다.';
    end if;
    insert into ypl_schema_validation.hall_of_fame_entries (
        id, event_id, result_id, player_id, generation_number, generation_label
    ) values (
        p_hall_of_fame_id, p_event_id, v_result.id, v_player_id,
        v_generation, v_generation::text || '대 챔피언'
    );
    return query select p_hall_of_fame_id, v_result.id, v_player_id, v_generation, true;
end;
$$;

create or replace function ypl_schema_validation.remove_championship_final_hall_of_fame(
    p_event_id uuid
)
returns table (hall_of_fame_id uuid, result_id uuid, player_id uuid, generation_number integer, removed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_event ypl_schema_validation.events%rowtype;
    v_existing ypl_schema_validation.hall_of_fame_entries%rowtype;
    v_count integer;
begin
    select * into v_event
      from ypl_schema_validation.events e
     where e.id = p_event_id
     for update;

    if not found
       or v_event.event_type <> 'champions'
       or v_event.championship_phase <> 'final'
       or v_event.status <> 'completed'
       or v_event.record_applied_at is null then
        raise exception using errcode = 'P0001', message = '기록 반영된 Champions Final만 Hall of Fame 등록을 취소할 수 있습니다.';
    end if;

    select count(*)::integer into v_count
      from ypl_schema_validation.hall_of_fame_entries h
     where h.event_id = p_event_id;

    if v_count = 0 then
        return query select null::uuid, null::uuid, null::uuid, null::integer, false;
        return;
    end if;

    if v_count <> 1 then
        raise exception using errcode = 'P0001', message = 'Champions Final Hall of Fame가 정확히 1건이 아닙니다.';
    end if;

    select * into v_existing
      from ypl_schema_validation.hall_of_fame_entries h
     where h.event_id = p_event_id
     for update;

    if not exists (
        select 1
          from ypl_schema_validation.results r
         where r.id = v_existing.result_id
           and r.event_id = p_event_id
           and r.placement_code = 'champion'
    ) then
        raise exception using errcode = 'P0001', message = 'Hall of Fame가 canonical champion Result를 참조하지 않습니다.';
    end if;

    delete from ypl_schema_validation.hall_of_fame_entries h
     where h.id = v_existing.id;

    return query
    select v_existing.id, v_existing.result_id, v_existing.player_id, v_existing.generation_number, true;
end;
$$;

create or replace function ypl_schema_validation.cancel_championship_application_event_pair(
    p_qualifier_event_id uuid,
    p_final_event_id uuid
)
returns table (qualifier_event_id uuid, final_event_id uuid, cancelled boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_qualifier ypl_schema_validation.events%rowtype;
    v_final ypl_schema_validation.events%rowtype;
begin
    select * into v_qualifier from ypl_schema_validation.events e where e.id = p_qualifier_event_id for update;
    select * into v_final from ypl_schema_validation.events e where e.id = p_final_event_id for update;
    if v_qualifier.id is null or v_final.id is null
       or v_qualifier.event_type <> 'champions' or v_qualifier.championship_phase <> 'qualifier'
       or v_qualifier.championship_final_event_id <> v_final.id
       or v_final.event_type <> 'champions' or v_final.championship_phase <> 'final' then
        raise exception using errcode = 'P0001', message = '취소할 Champions Event pair ownership이 일치하지 않습니다.';
    end if;
    if v_qualifier.record_applied_at is not null or v_final.record_applied_at is not null
       or v_qualifier.status not in ('open', 'cancelled') or v_final.status not in ('open', 'cancelled')
       or exists (select 1 from ypl_schema_validation.event_registrations r where r.event_id in (p_qualifier_event_id, p_final_event_id))
       or exists (select 1 from ypl_schema_validation.entries e where e.event_id in (p_qualifier_event_id, p_final_event_id))
       or exists (select 1 from ypl_schema_validation.matches m where m.event_id in (p_qualifier_event_id, p_final_event_id))
       or exists (select 1 from ypl_schema_validation.results r where r.event_id in (p_qualifier_event_id, p_final_event_id))
       or exists (select 1 from ypl_schema_validation.bracket_runtimes br where br.event_id in (p_qualifier_event_id, p_final_event_id)) then
        raise exception using errcode = 'P0001', message = 'Champions pair에 downstream 사실이 있어 공지 삭제 시 Event를 보존합니다.';
    end if;
    update ypl_schema_validation.events e set status = 'cancelled', updated_at = now()
     where e.id in (p_qualifier_event_id, p_final_event_id);
    return query select p_qualifier_event_id, p_final_event_id, true;
end;
$$;

revoke all on function ypl_schema_validation.save_championship_application_event_pair(uuid, uuid, uuid, text, text, integer, text, integer, integer, integer, text, text, jsonb, jsonb, jsonb, date, timestamptz) from public;
revoke all on function ypl_schema_validation.save_championship_application_event_pair(uuid, uuid, uuid, text, text, integer, text, integer, integer, integer, text, text, jsonb, jsonb, jsonb, date, timestamptz) from authenticated, service_role;
grant execute on function ypl_schema_validation.save_championship_application_event_pair(uuid, uuid, uuid, text, text, integer, text, integer, integer, integer, text, text, jsonb, jsonb, jsonb, date, timestamptz) to anon;
revoke all on function ypl_schema_validation.cancel_championship_application_event_pair(uuid, uuid) from public;
revoke all on function ypl_schema_validation.cancel_championship_application_event_pair(uuid, uuid) from authenticated, service_role;
grant execute on function ypl_schema_validation.cancel_championship_application_event_pair(uuid, uuid) to anon;
revoke all on function ypl_schema_validation.create_championship_advancement(uuid, uuid, uuid, uuid, text, uuid, text) from public;
revoke all on function ypl_schema_validation.create_championship_advancement(uuid, uuid, uuid, uuid, text, uuid, text) from authenticated, service_role;
grant execute on function ypl_schema_validation.create_championship_advancement(uuid, uuid, uuid, uuid, text, uuid, text) to anon;
revoke all on function ypl_schema_validation.cancel_championship_advancement(uuid) from public;
revoke all on function ypl_schema_validation.cancel_championship_advancement(uuid) from authenticated, service_role;
grant execute on function ypl_schema_validation.cancel_championship_advancement(uuid) to anon;
revoke all on function ypl_schema_validation.ensure_championship_final_hall_of_fame(uuid, uuid) from public;
revoke all on function ypl_schema_validation.ensure_championship_final_hall_of_fame(uuid, uuid) from authenticated, service_role;
grant execute on function ypl_schema_validation.ensure_championship_final_hall_of_fame(uuid, uuid) to anon;
revoke all on function ypl_schema_validation.remove_championship_final_hall_of_fame(uuid) from public;
revoke all on function ypl_schema_validation.remove_championship_final_hall_of_fame(uuid) from authenticated, service_role;
grant execute on function ypl_schema_validation.remove_championship_final_hall_of_fame(uuid) to anon;

-- Read-only access is required for the operator panel and Hall of Fame page;
-- all Champions writes above remain domain-RPC-only.
grant select on table ypl_schema_validation.championship_advancements to anon;
grant select on table ypl_schema_validation.hall_of_fame_entries to anon;
