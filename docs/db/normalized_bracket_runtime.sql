-- YPL normalized bracket runtime schema v1
-- Status: DRAFT / DO NOT RUN ON PRODUCTION
--
-- This is an additive extension to normalized_schema_v1.sql. It is intentionally
-- schema-qualified for the Test target (ypl_schema_validation) and contains no
-- data writes, RPCs, or legacy ypl_data_v4 migration.
--
-- Canonical boundaries:
-- - bracket_runtimes row existence discriminates a normalized bracket runtime.
-- - bracket_entry_slots stores the actual draw, never Entry.seed.
-- - bracket_identity_changes stores create-time ownership and restore facts.
-- - Match keeps only an actually formed match. It deliberately has no
--   bracket_runtime_id column; the future runtime source is
--   source='normalized_bracket_runtime' with
--   source_node_key='single:r{round}:m{match}'.
-- - BYE, future nodes, and topology edges remain projection-generated.
-- - Existing/historical Event-linked brackets without a runtime row remain
--   legacy-compatible; no backfill is defined here.
--
-- Create transaction contract (future RPC):
-- Event lock -> runtime -> identity -> Entry/EntryParticipant -> ownership
-- -> slots -> immediately formed Match rows -> Event running -> commit.
-- The RPC must accept a client-supplied runtime id for idempotent retry:
-- same runtime id and same payload re-reads the committed success; a different
-- payload for an existing runtime id fails closed.
--
-- Delete transaction contract (future RPC):
-- Event/runtime lock -> read-only preflight under lock -> runtime Match -> slots
-- -> EntryParticipant -> Entry -> Registration/player restore/delete
-- -> runtime -> previous Event status restore -> commit.
-- Any preflight failure is a full no-op. Result winner create/change/cancel is a
-- separate future atomic RPC. A normalized runtime with missing or duplicate
-- slots never falls back to Entry-id ordering.

begin;

create table if not exists ypl_schema_validation.bracket_runtimes (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null,

    topology_kind text not null
        check (topology_kind = 'single_elimination'),
    projection_version smallint not null default 1
        check (projection_version > 0),
    previous_event_status text not null
        check (previous_event_status in ('open', 'running')),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint uq_bracket_runtimes_event
        unique (event_id),
    -- The redundant-looking composite key is required by child same-Event FKs.
    constraint uq_bracket_runtimes_id_event
        unique (id, event_id),
    constraint fk_bracket_runtimes_event
        foreign key (event_id)
        references ypl_schema_validation.events(id)
        on delete restrict
);

create index if not exists idx_bracket_runtimes_event_id
    on ypl_schema_validation.bracket_runtimes (event_id);


create table if not exists ypl_schema_validation.bracket_entry_slots (
    bracket_runtime_id uuid not null,
    event_id uuid not null,

    stage_kind text not null
        check (stage_kind in ('elimination', 'group')),
    stage_no smallint not null
        check (stage_no > 0),
    pool_no smallint not null default 0
        check (pool_no >= 0),
    slot_no integer not null
        check (slot_no > 0),
    entry_id uuid not null,

    created_at timestamptz not null default now(),

    constraint pk_bracket_entry_slots
        primary key (bracket_runtime_id, stage_kind, stage_no, pool_no, slot_no),
    constraint uq_bracket_entry_slots_entry
        unique (bracket_runtime_id, stage_kind, stage_no, entry_id),
    constraint fk_bracket_entry_slots_runtime
        foreign key (bracket_runtime_id, event_id)
        references ypl_schema_validation.bracket_runtimes(id, event_id)
        on delete restrict,
    constraint fk_bracket_entry_slots_entry
        foreign key (entry_id, event_id)
        references ypl_schema_validation.entries(id, event_id)
        on delete restrict,
    constraint ck_bracket_entry_slots_pool
        check (
            (stage_kind = 'elimination' and pool_no = 0)
            or
            (stage_kind = 'group' and pool_no > 0)
        )
);

create index if not exists idx_bracket_entry_slots_event_id
    on ypl_schema_validation.bracket_entry_slots (event_id);

create index if not exists idx_bracket_entry_slots_entry_event
    on ypl_schema_validation.bracket_entry_slots (entry_id, event_id);


-- entry_participants already has id as its primary key. This additional
-- composite unique target allows ownership to assert that the participant,
-- Entry, Registration, Player, and Event are the same row tuple.
do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conname = 'uq_entry_participants_event_identity'
           and conrelid = 'ypl_schema_validation.entry_participants'::regclass
    ) then
        alter table ypl_schema_validation.entry_participants
            add constraint uq_entry_participants_event_identity
            unique (id, event_id, entry_id, registration_id, player_id);
    end if;
end
$$;


create table if not exists ypl_schema_validation.bracket_identity_changes (
    bracket_runtime_id uuid not null,
    event_id uuid not null,
    entry_participant_id uuid not null,
    entry_id uuid not null,
    registration_id uuid not null,
    player_id uuid not null,

    player_was_created boolean not null default false,
    registration_was_created boolean not null default false,
    registration_player_was_changed boolean not null default false,
    previous_registration_player_id uuid,
    entry_was_created boolean not null default false,
    entry_participant_was_created boolean not null default false,

    created_at timestamptz not null default now(),

    constraint pk_bracket_identity_changes
        primary key (bracket_runtime_id, entry_participant_id),
    constraint uq_bracket_identity_changes_registration
        unique (bracket_runtime_id, registration_id),
    constraint uq_bracket_identity_changes_player
        unique (bracket_runtime_id, player_id),
    constraint fk_bracket_identity_changes_runtime
        foreign key (bracket_runtime_id, event_id)
        references ypl_schema_validation.bracket_runtimes(id, event_id)
        on delete restrict,
    constraint fk_bracket_identity_changes_participant
        foreign key (
            entry_participant_id,
            event_id,
            entry_id,
            registration_id,
            player_id
        )
        references ypl_schema_validation.entry_participants(
            id,
            event_id,
            entry_id,
            registration_id,
            player_id
        )
        on delete restrict,
    constraint fk_bracket_identity_changes_entry
        foreign key (entry_id, event_id)
        references ypl_schema_validation.entries(id, event_id)
        on delete restrict,
    constraint fk_bracket_identity_changes_registration
        foreign key (registration_id, event_id, player_id)
        references ypl_schema_validation.event_registrations(id, event_id, player_id)
        on delete restrict,
    constraint fk_bracket_identity_changes_player
        foreign key (player_id)
        references ypl_schema_validation.players(id)
        on delete restrict,
    constraint fk_bracket_identity_changes_previous_player
        foreign key (previous_registration_player_id)
        references ypl_schema_validation.players(id)
        on delete restrict,
    constraint ck_bracket_identity_changes_registration_origin
        check (
            not registration_was_created
            or not registration_player_was_changed
        ),
    constraint ck_bracket_identity_changes_previous_player
        check (
            registration_player_was_changed
            or previous_registration_player_id is null
        ),
    constraint ck_bracket_identity_changes_changed_player
        check (
            not registration_player_was_changed
            or previous_registration_player_id is distinct from player_id
        ),
    constraint ck_bracket_identity_changes_entry_origin
        check (
            not entry_was_created
            or entry_participant_was_created
        )
);

create index if not exists idx_bracket_identity_changes_event_id
    on ypl_schema_validation.bracket_identity_changes (event_id);

create index if not exists idx_bracket_identity_changes_participant_event
    on ypl_schema_validation.bracket_identity_changes (entry_participant_id, event_id);

create index if not exists idx_bracket_identity_changes_entry_event
    on ypl_schema_validation.bracket_identity_changes (entry_id, event_id);

create unique index if not exists uq_bracket_identity_changes_created_entry
    on ypl_schema_validation.bracket_identity_changes (bracket_runtime_id, event_id, entry_id)
    where entry_was_created;

commit;
