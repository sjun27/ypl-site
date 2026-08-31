-- YPL normalized database schema v1
-- Status: DRAFT / DO NOT RUN ON PRODUCTION
-- Generated from docs/ARCHITECTURE.md normalized logical model.
--
-- This file defines the target PostgreSQL/Supabase structure only.
-- Production migration must happen after:
--   1) SQL review
--   2) test schema creation
--   3) ypl_data_v4 migration dry-run
--   4) record-count / representative-case verification

create extension if not exists pgcrypto;

-- =========================================================
-- 1. Players
-- =========================================================

create table if not exists players (
    id uuid primary key default gen_random_uuid(),
    display_name text not null,
    status text not null default 'active'
        check (status in ('active', 'inactive')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- display_name is intentionally NOT globally unique.
create index if not exists idx_players_display_name
    on players (display_name);


-- =========================================================
-- 2. Seasons
-- =========================================================

create table if not exists seasons (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,
    name text not null,
    series text,
    number smallint,
    starts_on date,
    ends_on date,
    sort_order integer not null default 0,
    status text not null default 'past'
        check (status in ('past', 'current', 'planned')),
    created_at timestamptz not null default now(),

    check (number is null or number > 0),
    check (
        starts_on is null
        or ends_on is null
        or starts_on <= ends_on
    )
);

create index if not exists idx_seasons_sort_order
    on seasons (sort_order);


-- =========================================================
-- 3. Events
-- =========================================================

create table if not exists events (
    id uuid primary key default gen_random_uuid(),
    season_id uuid references seasons(id) on delete restrict,

    name text not null,
    round_number integer,

    event_type text not null,
    division text,
    battle_format text,
    competition_format text,
    competition_settings jsonb not null default '{}'::jsonb,
    is_team_event boolean not null default false,

    regulation_id text,
    cup_rule_id text,
    cup_rule_settings jsonb not null default '{}'::jsonb,
    registration_settings jsonb not null default '{}'::jsonb,

    held_on date,
    date_precision text not null default 'exact'
        check (date_precision in ('exact', 'month', 'year', 'unknown')),

    record_completeness text not null default 'partial'
        check (
            record_completeness in (
                'full_match',
                'placement',
                'winner_only',
                'partial'
            )
        ),

    status text not null default 'planned'
        check (
            status in (
                'planned',
                'open',
                'running',
                'completed',
                'cancelled'
            )
        ),

    -- Soft target time. This does NOT block late first submissions
    -- or re-submissions while the event is active.
    submission_target_at timestamptz,

    team_reveal_mode text not null default 'on_record_apply'
        check (
            team_reveal_mode in (
                'on_record_apply',
                'scheduled',
                'manual'
            )
        ),
    team_reveal_at timestamptz,
    team_revealed_at timestamptz,

    record_applied_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    check (round_number is null or round_number > 0),
    check (
        team_reveal_mode <> 'scheduled'
        or team_reveal_at is not null
    )
);

create index if not exists idx_events_season_id
    on events (season_id);

create index if not exists idx_events_held_on
    on events (held_on);

create index if not exists idx_events_type_format
    on events (event_type, battle_format);



-- =========================================================
-- 4. Event registrations
-- =========================================================
-- Canonical person-event anchor for application/submission.
--
-- application = real new application
-- advancement = Champions final berth created from ranking/qualifier/manual advancement
-- manual      = operator-created operational registration
-- migration   = technical legacy anchor; not evidence that an old
--               application form existed.

create table if not exists event_registrations (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references events(id) on delete restrict,
    player_id uuid not null references players(id) on delete restrict,

    registration_name text not null,
    registration_data jsonb not null default '{}'::jsonb,

    registration_source text not null default 'application'
        check (
            registration_source in (
                'application',
                'advancement',
                'manual',
                'migration'
            )
        ),

    registered_at timestamptz,

    -- FK added after registration_submissions.
    final_submission_id uuid,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (event_id, player_id),
    unique (id, event_id, player_id)
);

create index if not exists idx_event_registrations_event_id
    on event_registrations (event_id);

create index if not exists idx_event_registrations_player_id
    on event_registrations (player_id);

create index if not exists idx_event_registrations_name
    on event_registrations (event_id, registration_name);

create index if not exists idx_event_registrations_source
    on event_registrations (registration_source);


-- =========================================================
-- 5. Entries
-- =========================================================

create table if not exists entries (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references events(id) on delete restrict,

    entry_type text not null
        check (entry_type in ('individual', 'team')),
    display_name text,
    seed integer,
    status text not null default 'active'
        check (status in ('active', 'withdrawn')),

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (id, event_id),

    check (seed is null or seed > 0)
);

create index if not exists idx_entries_event_id
    on entries (event_id);


-- =========================================================
-- 6. Entry participants
-- =========================================================
-- Actual bracket participants. Each row is linked back to the
-- EventRegistration that existed before bracket/team assignment.

create table if not exists entry_participants (
    id uuid primary key default gen_random_uuid(),

    event_id uuid not null references events(id) on delete restrict,
    entry_id uuid not null,
    registration_id uuid not null,
    player_id uuid not null references players(id) on delete restrict,

    member_order smallint not null default 1,
    role text,

    created_at timestamptz not null default now(),

    unique (entry_id, player_id),
    unique (entry_id, member_order),
    unique (event_id, player_id),
    unique (registration_id),

    foreign key (entry_id, event_id)
        references entries(id, event_id)
        on delete restrict,

    foreign key (registration_id, event_id, player_id)
        references event_registrations(id, event_id, player_id)
        on delete restrict,

    check (member_order > 0)
);

create index if not exists idx_entry_participants_entry_id
    on entry_participants (entry_id);

create index if not exists idx_entry_participants_player_id
    on entry_participants (player_id);

create index if not exists idx_entry_participants_registration_id
    on entry_participants (registration_id);


-- =========================================================
-- 7. Team snapshots
-- =========================================================
-- Immutable competition facts.
-- Participant-local monotype assignedType is intentionally excluded.

create table if not exists team_snapshots (
    id uuid primary key default gen_random_uuid(),
    schema_version smallint not null default 1,

    regulation_id text,
    cup_rule_id text,
    cup_rule_settings jsonb not null default '{}'::jsonb,

    source_type text not null default 'manual'
        check (
            source_type in (
                'manual',
                'replica_import',
                'historical'
            )
        ),
    source_reference text,
    imported_at timestamptz,

    created_at timestamptz not null default now(),

    check (schema_version > 0)
);


-- =========================================================
-- 8. Team snapshot members
-- =========================================================

create table if not exists team_snapshot_members (
    id uuid primary key default gen_random_uuid(),
    snapshot_id uuid not null
        references team_snapshots(id) on delete restrict,

    slot smallint not null,

    -- pokemon_id must be a stable form-specific canonical ID.
    pokemon_id text,
    pokemon_name_snapshot text not null,

    ability_id text,
    nature_id text,

    stat_hp smallint not null default 0,
    stat_atk smallint not null default 0,
    stat_def smallint not null default 0,
    stat_spa smallint not null default 0,
    stat_spd smallint not null default 0,
    stat_spe smallint not null default 0,

    item_id text,

    move_1_id text,
    move_2_id text,
    move_3_id text,
    move_4_id text,

    unique (snapshot_id, slot),

    check (slot between 1 and 6),

    -- Regulation-specific maximum/total validation remains in
    -- Team Builder/application logic. DB only prevents negatives.
    check (stat_hp >= 0),
    check (stat_atk >= 0),
    check (stat_def >= 0),
    check (stat_spa >= 0),
    check (stat_spd >= 0),
    check (stat_spe >= 0)
);

create index if not exists idx_team_snapshot_members_snapshot_id
    on team_snapshot_members (snapshot_id);

create index if not exists idx_team_snapshot_members_pokemon_id
    on team_snapshot_members (pokemon_id);


-- =========================================================
-- 9. Registration submissions
-- =========================================================
-- Submission belongs to EventRegistration so it can exist before
-- Entry/team assignment.

create table if not exists registration_submissions (
    id uuid primary key default gen_random_uuid(),

    registration_id uuid not null
        references event_registrations(id) on delete restrict,

    snapshot_id uuid not null
        references team_snapshots(id) on delete restrict,

    revision integer not null,

    -- Nullable for historical migration when the original submission
    -- timestamp is unknown. New application code should always provide it.
    submitted_at timestamptz,

    source text not null default 'team_builder',

    created_at timestamptz not null default now(),

    unique (registration_id, revision),
    unique (snapshot_id),
    unique (id, registration_id),

    check (revision > 0)
);

create index if not exists idx_registration_submissions_registration_id
    on registration_submissions (registration_id);

create index if not exists idx_registration_submissions_submitted_at
    on registration_submissions (submitted_at);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'fk_event_registration_final_submission'
          and conrelid = 'event_registrations'::regclass
    ) then
        alter table event_registrations
            add constraint fk_event_registration_final_submission
            foreign key (final_submission_id, id)
            references registration_submissions (id, registration_id)
            on delete restrict;
    end if;
end
$$;


-- =========================================================
-- 10. Matches
-- =========================================================

create table if not exists matches (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references events(id) on delete restrict,

    parent_match_id uuid references matches(id) on delete restrict,

    match_kind text not null
        check (match_kind in ('bracket', 'team_bout', 'ace')),

    round_number smallint,
    stage_label text,
    sequence_no integer,

    entry_a_id uuid references entries(id) on delete restrict,
    entry_b_id uuid references entries(id) on delete restrict,

    player_a_id uuid references players(id) on delete restrict,
    player_b_id uuid references players(id) on delete restrict,

    winner_entry_id uuid references entries(id) on delete restrict,
    winner_player_id uuid references players(id) on delete restrict,

    resolution text not null default 'played'
        check (
            resolution in (
                'played',
                'forfeit',
                'admin',
                'draw',
                'cancelled',
                'unknown'
            )
        ),

    source text not null,
    source_node_key text,

    played_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (id, event_id),

    foreign key (parent_match_id, event_id)
        references matches(id, event_id) on delete restrict,

    foreign key (entry_a_id, event_id)
        references entries(id, event_id) on delete restrict,
    foreign key (entry_b_id, event_id)
        references entries(id, event_id) on delete restrict,
    foreign key (winner_entry_id, event_id)
        references entries(id, event_id) on delete restrict,

    check (round_number is null or round_number > 0),
    check (sequence_no is null or sequence_no > 0),

    check (
        entry_a_id is null
        or entry_b_id is null
        or entry_a_id <> entry_b_id
    ),

    check (
        player_a_id is null
        or player_b_id is null
        or player_a_id <> player_b_id
    ),

    check (
        winner_entry_id is null
        or winner_entry_id = entry_a_id
        or winner_entry_id = entry_b_id
    ),

    check (
        winner_player_id is null
        or winner_player_id = player_a_id
        or winner_player_id = player_b_id
    ),

    -- A bracket match is between Entries.
    -- A team_bout / ace is between Players and should have a parent
    -- team-vs-team match.
    check (
        (
            match_kind = 'bracket'
            and parent_match_id is null
            and entry_a_id is not null
            and entry_b_id is not null
            and player_a_id is null
            and player_b_id is null
            and winner_player_id is null
        )
        or
        (
            match_kind in ('team_bout', 'ace')
            and parent_match_id is not null
            and player_a_id is not null
            and player_b_id is not null
            and entry_a_id is null
            and entry_b_id is null
            and winner_entry_id is null
        )
    )
);

create index if not exists idx_matches_event_id
    on matches (event_id);

create index if not exists idx_matches_parent_match_id
    on matches (parent_match_id);

create index if not exists idx_matches_players
    on matches (player_a_id, player_b_id);

create unique index if not exists uq_matches_source_node
    on matches (event_id, source, source_node_key)
    where source_node_key is not null;


-- =========================================================
-- 11. Results
-- =========================================================

create table if not exists results (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references events(id) on delete restrict,
    entry_id uuid not null references entries(id) on delete restrict,

    placement_code text not null,
    rank_min smallint,
    rank_max smallint,
    placement_label text not null,

    source text not null,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (event_id, entry_id),
    unique (id, event_id),

    foreign key (entry_id, event_id)
        references entries(id, event_id) on delete restrict,

    check (rank_min is null or rank_min > 0),
    check (rank_max is null or rank_max > 0),
    check (
        rank_min is null
        or rank_max is null
        or rank_min <= rank_max
    )
);

create index if not exists idx_results_event_id
    on results (event_id);

create index if not exists idx_results_entry_id
    on results (entry_id);

create index if not exists idx_results_placement_code
    on results (placement_code);


-- =========================================================
-- 12. Ranking baselines
-- =========================================================

create table if not exists ranking_baselines (
    id uuid primary key default gen_random_uuid(),
    player_id uuid not null references players(id) on delete restrict,

    scope text not null
        check (scope in ('series', 'season')),
    series text,
    season_id uuid references seasons(id) on delete restrict,

    points numeric(10,2) not null default 0,
    wins integer not null default 0,
    runner_ups integer not null default 0,
    top4s integer not null default 0,

    source text not null,
    captured_at timestamptz not null default now(),
    note text,

    check (
        (
            scope = 'series'
            and series is not null
            and season_id is null
        )
        or
        (
            scope = 'season'
            and series is null
            and season_id is not null
        )
    ),

    check (wins >= 0),
    check (runner_ups >= 0),
    check (top4s >= 0)
);

create unique index if not exists uq_ranking_baseline_series
    on ranking_baselines (player_id, series)
    where scope = 'series';

create unique index if not exists uq_ranking_baseline_season
    on ranking_baselines (player_id, season_id)
    where scope = 'season';

create index if not exists idx_ranking_baselines_season_id
    on ranking_baselines (season_id);


-- =========================================================
-- 13. Ranking awards
-- =========================================================

create table if not exists ranking_awards (
    id uuid primary key default gen_random_uuid(),

    event_id uuid not null references events(id) on delete restrict,
    player_id uuid not null references players(id) on delete restrict,
    result_id uuid references results(id) on delete restrict,

    award_kind text not null
        check (
            award_kind in (
                'placement',
                'adjustment',
                'reversal'
            )
        ),

    points_delta numeric(10,2) not null default 0,
    win_delta integer not null default 0,
    runner_up_delta integer not null default 0,
    top4_delta integer not null default 0,

    counts_series boolean not null default true,
    counts_season boolean not null default true,

    related_award_id uuid references ranking_awards(id) on delete restrict,
    reason text,
    source text not null,

    created_at timestamptz not null default now(),

    foreign key (result_id, event_id)
        references results(id, event_id) on delete restrict,

    check (related_award_id is null or related_award_id <> id)
);

create index if not exists idx_ranking_awards_event_id
    on ranking_awards (event_id);

create index if not exists idx_ranking_awards_player_id
    on ranking_awards (player_id);

create index if not exists idx_ranking_awards_result_id
    on ranking_awards (result_id);

create index if not exists idx_ranking_awards_related_award_id
    on ranking_awards (related_award_id);


-- =========================================================
-- 14. Title definitions
-- =========================================================

create table if not exists title_definitions (
    id uuid primary key default gen_random_uuid(),

    code text not null unique,
    name text not null,
    description text,
    group_code text,

    award_mode text not null
        check (award_mode in ('auto', 'review', 'manual')),

    sort_order integer not null default 0,
    active boolean not null default true,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_title_definitions_group_code
    on title_definitions (group_code, sort_order);


-- =========================================================
-- 15. Title awards
-- =========================================================

create table if not exists title_awards (
    id uuid primary key default gen_random_uuid(),

    title_id uuid not null
        references title_definitions(id) on delete restrict,
    player_id uuid not null
        references players(id) on delete restrict,

    event_id uuid references events(id) on delete restrict,
    result_id uuid references results(id) on delete restrict,

    source text not null,
    reason text,

    -- Nullable when a historical award date cannot be reconstructed.
    -- New awards may omit this column and use the current timestamp default.
    awarded_at timestamptz default now(),
    revoked_at timestamptz,

    foreign key (result_id, event_id)
        references results(id, event_id) on delete restrict,

    check (result_id is null or event_id is not null),

    check (
        revoked_at is null
        or revoked_at >= awarded_at
    )
);

create index if not exists idx_title_awards_player_id
    on title_awards (player_id);

create index if not exists idx_title_awards_title_id
    on title_awards (title_id);

create unique index if not exists uq_title_awards_active
    on title_awards (player_id, title_id)
    where revoked_at is null;


-- =========================================================
-- 16. Player partner Pokémon
-- =========================================================
-- Legacy titleGroups.partner is NOT a normal title award.
-- Its item name is a player and holders are Pokémon.
-- Preserve that relationship separately instead of creating fake Players.

create table if not exists player_partners (
    id uuid primary key default gen_random_uuid(),

    player_id uuid not null
        references players(id) on delete restrict,

    pokemon_id text,
    pokemon_name_snapshot text not null,

    source text not null,
    created_at timestamptz not null default now(),
    revoked_at timestamptz,

    check (
        revoked_at is null
        or revoked_at >= created_at
    )
);

create unique index if not exists uq_player_partners_active_name
    on player_partners (player_id, pokemon_name_snapshot)
    where revoked_at is null;

create index if not exists idx_player_partners_player_id
    on player_partners (player_id);

create index if not exists idx_player_partners_pokemon_id
    on player_partners (pokemon_id);


-- =========================================================
-- 17. Hall of Fame
-- =========================================================

create table if not exists hall_of_fame_entries (
    id uuid primary key default gen_random_uuid(),

    event_id uuid not null unique
        references events(id) on delete restrict,
    result_id uuid not null
        references results(id) on delete restrict,
    player_id uuid not null
        references players(id) on delete restrict,

    -- generation_number is intentionally NOT unique.
    -- Example: 7th Singles Champion and 7th Doubles Champion
    -- both use generation_number = 7.
    generation_number integer not null,
    generation_label text,

    -- Legacy/custom image compatibility only.
    -- New Pokémon party visuals derive from the winner's final TeamSnapshot.
    image_ref text,
    note text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    foreign key (result_id, event_id)
        references results(id, event_id) on delete restrict,

    check (generation_number > 0)
);

create index if not exists idx_hall_of_fame_generation
    on hall_of_fame_entries (generation_number);

create index if not exists idx_hall_of_fame_player_id
    on hall_of_fame_entries (player_id);


-- =========================================================
-- Notes for the next review pass
-- =========================================================
--
-- Intentionally NOT included yet:
--
-- 1. RLS policies
--    Security policy is a separate phase and must not be mixed into
--    the first structural review.
--
-- 2. Migration INSERT/UPDATE statements
--    Existing ypl_data_v4 data must be transformed only after this
--    schema is reviewed and tested.
--
-- 3. Automatic updated_at trigger
--    Can be added after table design is accepted.
--
-- 4. Regulation-specific Team Snapshot validation
--    Current Team Builder performs Regulation validation.
--    DB stores the submitted facts and only enforces generic integrity.
--
-- 5. Replica Team ID resolver
--    No stable arbitrary-code resolver has been confirmed.
--
-- 6. Latest migration compatibility
--    Existing historical EntryParticipant/Submission rows must be
--    connected through registration_source = 'migration' anchors.
--    These anchors are not evidence of historical application forms.
--
-- 7. Monotype assignedType
--    Participant-local selector only. Do not persist it in Registration
--    or TeamSnapshot.
--
-- Champions qualifier / final extension
--
-- A qualifier and its final are separate Event rows so each stage has
-- independent EventRegistration / Entry / RegistrationSubmission /
-- TeamSnapshot data.
-- Historical Champions events may keep championship_phase NULL when the
-- qualifier/final distinction was not preserved.
alter table events
    add column if not exists championship_phase text null,
    add column if not exists championship_final_event_id uuid null,
    add column if not exists qualification_slots integer null;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'fk_events_championship_final_event'
          and conrelid = 'events'::regclass
    ) then
        alter table events
            add constraint fk_events_championship_final_event
            foreign key (championship_final_event_id)
            references events(id)
            on delete restrict;
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'chk_events_championship_phase'
          and conrelid = 'events'::regclass
    ) then
        alter table events
            add constraint chk_events_championship_phase
            check (
                championship_phase is null
                or championship_phase in ('qualifier', 'final')
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'chk_events_championship_only'
          and conrelid = 'events'::regclass
    ) then
        alter table events
            add constraint chk_events_championship_only
            check (
                championship_phase is null
                or event_type = 'champions'
            );
    end if;

    if not exists (
        select 1 from pg_constraint
        where conname = 'chk_events_championship_stage_shape'
          and conrelid = 'events'::regclass
    ) then
        alter table events
            add constraint chk_events_championship_stage_shape
            check (
                (
                    championship_phase is null
                    and championship_final_event_id is null
                    and qualification_slots is null
                )
                or
                (
                    championship_phase = 'qualifier'
                    and championship_final_event_id is not null
                    and championship_final_event_id <> id
                    and qualification_slots is not null
                    and qualification_slots > 0
                )
                or
                (
                    championship_phase = 'final'
                    and championship_final_event_id is null
                    and qualification_slots is null
                )
            );
    end if;
end
$$;

create index if not exists idx_events_championship_final_event
    on events(championship_final_event_id)
    where championship_final_event_id is not null;

-- Records how a Final EventRegistration obtained its berth.
--
-- The Final Registration exists before the Final bracket/Entry so the
-- participant can submit a completely independent Final TeamSnapshot.
--
-- ranking   : operator selected the player directly from the season ranking
-- qualifier : player advanced from a separate qualifier Entry
-- manual    : operational exception such as a replacement
--
-- This relationship never copies a TeamSnapshot. The qualifier and final
-- remain independent submissions.
create table if not exists championship_advancements (
    id uuid primary key default gen_random_uuid(),

    final_registration_id uuid not null
        references event_registrations(id)
        on delete restrict,

    source_entry_id uuid null
        references entries(id)
        on delete restrict,

    advancement_type text not null
        check (advancement_type in ('ranking', 'qualifier', 'manual')),

    reason text null,

    created_at timestamptz not null default now(),

    constraint uq_championship_advancement_final_registration
        unique (final_registration_id),

    constraint chk_championship_advancement_source
        check (
            (advancement_type = 'ranking' and source_entry_id is null)
            or
            (advancement_type = 'qualifier' and source_entry_id is not null)
            or
            advancement_type = 'manual'
        )
);

create index if not exists idx_championship_advancements_source_entry
    on championship_advancements(source_entry_id)
    where source_entry_id is not null;

create index if not exists idx_championship_advancements_type
    on championship_advancements(advancement_type);

-- End of normalized_schema_v1.sql
