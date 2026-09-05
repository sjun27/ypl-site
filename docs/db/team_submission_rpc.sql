-- YPL TeamSnapshot / RegistrationSubmission atomic write
-- Status: DRAFT / DO NOT RUN ON PRODUCTION
--
-- Run this function in the same normalized schema used by the app
-- (ypl_schema_validation for Test). The browser calls it through the
-- schema-scoped Supabase client. This file is intentionally not applied by
-- this change.

-- If an earlier draft with the client-supplied timestamp was applied, remove
-- that overload before creating the canonical five-argument RPC.
drop function if exists ypl_schema_validation.submit_registration_team_snapshot(
    uuid, uuid, text, jsonb, jsonb, timestamptz
);

create or replace function ypl_schema_validation.submit_registration_team_snapshot(
    p_event_id uuid,
    p_registration_id uuid,
    p_registration_name text,
    p_snapshot jsonb,
    p_members jsonb
)
returns table (
    submission_id uuid,
    snapshot_id uuid,
    revision integer,
    submitted_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_event ypl_schema_validation.events%rowtype;
    v_registration ypl_schema_validation.event_registrations%rowtype;
    v_snapshot_id uuid;
    v_submission_id uuid;
    v_revision integer;
    v_submitted_at timestamptz;
begin
    if p_event_id is null or p_registration_id is null then
        raise exception using errcode = 'P0001', message = 'Event와 Registration이 필요합니다.';
    end if;

    if nullif(btrim(coalesce(p_registration_name, '')), '') is null then
        raise exception using errcode = 'P0001', message = '신청자 이름을 입력해 주세요.';
    end if;

    if jsonb_typeof(coalesce(p_snapshot, '{}'::jsonb)) <> 'object'
       or jsonb_typeof(coalesce(p_members, '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(p_members, '[]'::jsonb)) < 1
       or jsonb_array_length(coalesce(p_members, '[]'::jsonb)) > 6 then
        raise exception using errcode = 'P0001', message = '제출 Snapshot 형식이 올바르지 않습니다.';
    end if;

    -- Lock the Event before checking its write gate so completion cannot race
    -- with a submission transaction.
    select *
      into v_event
      from ypl_schema_validation.events
     where id = p_event_id
     for update;

    if not found then
        raise exception using errcode = 'P0001', message = '연결된 Event를 찾을 수 없습니다.';
    end if;
    if v_event.status not in ('open', 'running') then
        raise exception using errcode = 'P0001', message = '현재 파티를 제출할 수 없는 Event입니다.';
    end if;
    if v_event.record_applied_at is not null then
        raise exception using errcode = 'P0001', message = '기록 반영이 완료된 Event에는 파티를 제출할 수 없습니다.';
    end if;
    if v_event.regulation_id is null or v_event.cup_rule_id is null then
        raise exception using errcode = 'P0001', message = 'Event의 Regulation/Cup Rule을 확인할 수 없어 파티를 제출할 수 없습니다.';
    end if;

    -- Registration identity and exact name are checked again inside the
    -- transaction; the client-side lookup is not trusted as the write gate.
    select *
      into v_registration
      from ypl_schema_validation.event_registrations
     where id = p_registration_id
       and event_id = p_event_id
       and registration_name = btrim(p_registration_name)
       and registration_source in ('application', 'advancement', 'manual')
     for update;

    if not found then
        raise exception using errcode = 'P0001', message = 'Event의 신청자 exact match를 확인하지 못했습니다.';
    end if;

    -- The row lock above serializes revisions for this Registration. The
    -- UNIQUE(registration_id, revision) constraint remains the final guard.
    select coalesce(max(rs.revision), 0) + 1
      into v_revision
      from ypl_schema_validation.registration_submissions rs
     where rs.registration_id = v_registration.id;

    insert into ypl_schema_validation.team_snapshots (
        schema_version,
        regulation_id,
        cup_rule_id,
        cup_rule_settings,
        source_type,
        source_reference
    ) values (
        1,
        v_event.regulation_id,
        v_event.cup_rule_id,
        coalesce(v_event.cup_rule_settings, '{}'::jsonb),
        'manual',
        null
    ) returning id into v_snapshot_id;

    insert into ypl_schema_validation.team_snapshot_members (
        snapshot_id,
        slot,
        pokemon_id,
        pokemon_name_snapshot,
        ability_id,
        nature_id,
        stat_hp,
        stat_atk,
        stat_def,
        stat_spa,
        stat_spd,
        stat_spe,
        item_id,
        move_1_id,
        move_2_id,
        move_3_id,
        move_4_id
    )
    select
        v_snapshot_id,
        (member->>'slot')::smallint,
        nullif(member->>'pokemon_id', ''),
        coalesce(nullif(member->>'pokemon_name_snapshot', ''), '확인할 수 없는 포켓몬'),
        nullif(member->>'ability_id', ''),
        nullif(member->>'nature_id', ''),
        coalesce(nullif(member->>'stat_hp', '')::smallint, 0),
        coalesce(nullif(member->>'stat_atk', '')::smallint, 0),
        coalesce(nullif(member->>'stat_def', '')::smallint, 0),
        coalesce(nullif(member->>'stat_spa', '')::smallint, 0),
        coalesce(nullif(member->>'stat_spd', '')::smallint, 0),
        coalesce(nullif(member->>'stat_spe', '')::smallint, 0),
        nullif(member->>'item_id', ''),
        nullif(member->>'move_1_id', ''),
        nullif(member->>'move_2_id', ''),
        nullif(member->>'move_3_id', ''),
        nullif(member->>'move_4_id', '')
      from jsonb_array_elements(p_members) as member;

    v_submitted_at := now();

    insert into ypl_schema_validation.registration_submissions (
        registration_id,
        snapshot_id,
        revision,
        submitted_at,
        source
    ) values (
        v_registration.id,
        v_snapshot_id,
        v_revision,
        v_submitted_at,
        'team_builder'
    ) returning id into v_submission_id;

    return query
    select v_submission_id, v_snapshot_id, v_revision, v_submitted_at;
end;
$$;


-- P2-6 final submission lifecycle. These functions intentionally touch only
-- actual EntryParticipant registrations; application-only registrations are
-- never frozen or released by record apply/revert.

create or replace function ypl_schema_validation.freeze_event_final_submissions(
    p_event_id uuid
)
returns table (
    registration_id uuid,
    previous_final_submission_id uuid,
    final_submission_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_event ypl_schema_validation.events%rowtype;
    v_registration ypl_schema_validation.event_registrations%rowtype;
    v_final_submission_id uuid;
    v_now timestamptz := now();
begin
    select *
      into v_event
      from ypl_schema_validation.events
     where id = p_event_id
     for update;

    if not found then
        raise exception using errcode = 'P0001', message = 'final submission을 고정할 Event를 찾을 수 없습니다.';
    end if;
    if v_event.status not in ('open', 'running') or v_event.record_applied_at is not null then
        raise exception using errcode = 'P0001', message = '현재 final submission을 고정할 수 없는 Event입니다.';
    end if;

    -- The Event lock also serializes against submit_registration_team_snapshot,
    -- which locks this same Event before creating a new revision.
    for v_registration in
        select registration.*
          from ypl_schema_validation.event_registrations as registration
         where registration.event_id = p_event_id
           and exists (
               select 1
                 from ypl_schema_validation.entry_participants as participant
                where participant.event_id = p_event_id
                  and participant.registration_id = registration.id
           )
         order by registration.id
         for update
    loop
        select submission.id
          into v_final_submission_id
          from ypl_schema_validation.registration_submissions as submission
         where submission.registration_id = v_registration.id
         order by submission.revision desc
         limit 1;

        registration_id := v_registration.id;
        previous_final_submission_id := v_registration.final_submission_id;
        final_submission_id := v_final_submission_id;

        update ypl_schema_validation.event_registrations
           set final_submission_id = v_final_submission_id,
               updated_at = v_now
         where id = v_registration.id;

        return next;
    end loop;
end;
$$;


create or replace function ypl_schema_validation.restore_event_final_submissions(
    p_event_id uuid,
    p_snapshot jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_event ypl_schema_validation.events%rowtype;
    v_target_ids uuid[];
    v_snapshot_ids uuid[];
begin
    if jsonb_typeof(coalesce(p_snapshot, '[]'::jsonb)) <> 'array' then
        raise exception using errcode = 'P0001', message = 'final submission 보상 snapshot 형식이 올바르지 않습니다.';
    end if;

    select *
      into v_event
      from ypl_schema_validation.events
     where id = p_event_id
     for update;

    if not found then
        raise exception using errcode = 'P0001', message = 'final submission을 복구할 Event를 찾을 수 없습니다.';
    end if;
    if v_event.status = 'completed'
       or v_event.record_applied_at is not null
       or v_event.team_revealed_at is not null then
        raise exception using errcode = 'P0001', message = '최종 기록 반영이 완료된 Event의 final submission은 복구할 수 없습니다.';
    end if;

    select coalesce(array_agg(participant.registration_id order by participant.registration_id), '{}'::uuid[])
      into v_target_ids
      from ypl_schema_validation.entry_participants as participant
     where participant.event_id = p_event_id;
    select coalesce(array_agg(snapshot.registration_id order by snapshot.registration_id), '{}'::uuid[])
      into v_snapshot_ids
      from jsonb_to_recordset(p_snapshot) as snapshot(
          registration_id uuid,
          previous_final_submission_id uuid,
          final_submission_id uuid
      );

    if v_target_ids is distinct from v_snapshot_ids then
        raise exception using errcode = 'P0001', message = 'final submission 보상 대상이 현재 실제 참가자와 일치하지 않습니다.';
    end if;

    perform 1
      from ypl_schema_validation.event_registrations as registration
     where registration.event_id = p_event_id
       and registration.id = any(v_target_ids)
     for update;

    if exists (
        select 1
          from jsonb_to_recordset(p_snapshot) as snapshot(
              registration_id uuid,
              previous_final_submission_id uuid,
              final_submission_id uuid
          )
          join ypl_schema_validation.event_registrations as registration
            on registration.id = snapshot.registration_id
         where registration.event_id = p_event_id
           and registration.final_submission_id is distinct from snapshot.final_submission_id
    ) then
        raise exception using errcode = 'P0001', message = 'final submission 보상 대상이 변경되어 자동 복구를 중단했습니다.';
    end if;

    update ypl_schema_validation.event_registrations as registration
       set final_submission_id = snapshot.previous_final_submission_id,
           updated_at = now()
      from jsonb_to_recordset(p_snapshot) as snapshot(
          registration_id uuid,
          previous_final_submission_id uuid,
          final_submission_id uuid
      )
     where registration.id = snapshot.registration_id
       and registration.event_id = p_event_id;
end;
$$;


create or replace function ypl_schema_validation.release_event_final_submissions(
    p_event_id uuid
)
returns table (
    id uuid,
    status text,
    record_applied_at timestamptz,
    team_revealed_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_event ypl_schema_validation.events%rowtype;
    v_now timestamptz := now();
begin
    select *
      into v_event
      from ypl_schema_validation.events as event
     where event.id = p_event_id
     for update;

    if not found then
        raise exception using errcode = 'P0001', message = 'final submission을 해제할 Event를 찾을 수 없습니다.';
    end if;
    if v_event.status <> 'completed' or v_event.record_applied_at is null then
        raise exception using errcode = 'P0001', message = '기록 반영이 완료된 Event만 final submission을 해제할 수 있습니다.';
    end if;

    update ypl_schema_validation.event_registrations as registration
       set final_submission_id = null,
           updated_at = v_now
     where registration.event_id = p_event_id
       and exists (
           select 1
             from ypl_schema_validation.entry_participants as participant
            where participant.event_id = p_event_id
              and participant.registration_id = registration.id
       );

    update ypl_schema_validation.events as event
       set status = 'running',
           record_applied_at = null,
           team_revealed_at = null,
           updated_at = v_now
     where event.id = p_event_id;

    return query
    select v_event.id, 'running'::text, null::timestamptz, null::timestamptz;
end;
$$;
