import React from "react";
import { cancelApplicationEvent, saveApplicationEvent, saveChampionshipApplicationEventPair } from "../services/index.js";
import {
  AnnEditor,
  ChampionEditor,
  LoginModal,
  MetaEditor,
  RoundsEditor,
  StandingsEditor,
  TitleItemEditor,
} from "./editors/AdminEditors.jsx";

export default function AdminModalHost({ modal, data, setModal, save, setAdmin, flash, normTeam }) {
  if (!modal) return null;
  const close = () => setModal(null);

  if (modal.type === "login") {
    return (
      <LoginModal
        onClose={close}
        onSuccess={() => {
          setAdmin(true);
          close();
          flash("관리자 로그인 ✓");
        }}
      />
    );
  }

  if (modal.type === "meta") {
    return <MetaEditor meta={data.meta} onClose={close} onSave={(meta) => { save({ ...data, meta }); close(); }} />;
  }

  if (modal.type === "champion") {
    return (
      <ChampionEditor
        item={modal.item}
        normTeam={normTeam}
        onClose={close}
        onSave={(champion) => {
          const champions = modal.item
            ? data.champions.map((item) => item.id === champion.id ? champion : item)
            : [...data.champions, champion];
          save({ ...data, champions });
          close();
        }}
        onDelete={modal.item ? () => {
          save({ ...data, champions: data.champions.filter((item) => item.id !== modal.item.id) });
          close();
        } : null}
      />
    );
  }

  if (modal.type === "title") {
    return (
      <TitleItemEditor
        groupKey={modal.groupKey}
        item={modal.item}
        onClose={close}
        onSave={(item) => {
          const titleGroups = data.titleGroups.map((group) => group.key !== modal.groupKey ? group : {
            ...group,
            items: modal.item ? group.items.map((entry) => entry.id === item.id ? item : entry) : [...group.items, item],
          });
          save({ ...data, titleGroups });
          close();
        }}
        onDelete={modal.item ? () => {
          const titleGroups = data.titleGroups.map((group) => group.key !== modal.groupKey ? group : {
            ...group,
            items: group.items.filter((entry) => entry.id !== modal.item.id),
          });
          save({ ...data, titleGroups });
          close();
        } : null}
      />
    );
  }

  if (modal.type === "ann") {
    return (
      <AnnEditor
        item={modal.item}
        onClose={close}
        onSave={async (announcement) => {
          let nextAnnouncement = announcement;

          if (announcement.form?.enabled && announcement.form?.eventDraft?.name?.trim()) {
            try {
              const champions = announcement.form.eventDraft.eventType === "champions";
              const savedEvent = champions
                ? await saveChampionshipApplicationEventPair({
                    qualifierEventId: announcement.form.eventId || null,
                    announcementId: announcement.id,
                    eventDraft: { ...announcement.form.eventDraft },
                  })
                : await saveApplicationEvent({
                    eventId: announcement.form.eventId || null,
                    announcementId: announcement.id,
                    eventDraft: { ...announcement.form.eventDraft },
                  });
              const event = champions ? savedEvent.qualifierEvent : savedEvent;

              nextAnnouncement = {
                ...announcement,
                form: {
                  ...announcement.form,
                  eventId: event.id,
                },
              };
            } catch (error) {
              flash(`대회 연결 실패: ${error.message}`);
              return;
            }
          }

          const announcements = modal.item
            ? data.announcements.map((item) => item.id === nextAnnouncement.id ? nextAnnouncement : item)
            : [nextAnnouncement, ...data.announcements];

          const saved = await save({ ...data, announcements });

          if (!saved) {
            const wasExistingEvent = Boolean(modal.item?.form?.eventId);

            if (!wasExistingEvent && nextAnnouncement.form?.eventId) {
              try {
                await cancelApplicationEvent(nextAnnouncement.form.eventId);
              } catch (error) {
                flash?.(`공지 저장 실패 후 신규 Event 정리에도 실패했습니다: ${error?.message || "알 수 없는 오류"}`);
                return;
              }
            }

            flash?.("공지 저장에 실패했습니다. Event 상태를 확인해 주세요.");
            return;
          }

          close();
        }}
        onDelete={modal.item ? async () => {
          const eventId = modal.item.form?.eventId || null;

          const nextData = {
            ...data,
            announcements: data.announcements.filter((item) => item.id !== modal.item.id),
          };

          const saved = await save(nextData);
          if (!saved) {
            flash?.("공지 삭제 저장에 실패했습니다.");
            return;
          }

          if (eventId) {
            try {
              await cancelApplicationEvent(eventId);
            } catch (error) {
              const restored = await save(data);
              flash?.(
                restored
                  ? `연결 대회 정리에 실패해 공지 삭제를 되돌렸습니다: ${error?.message || "알 수 없는 오류"}`
                  : `연결 대회 정리와 공지 복구에 모두 실패했습니다: ${error?.message || "알 수 없는 오류"}`
              );
              return;
            }
          }

          close();
        } : null}
      />
    );
  }

  if (modal.type === "standings") {
    return <StandingsEditor title={modal.title} rows={modal.rows} onClose={close} onSave={(rows) => { save(modal.build(rows)); close(); }} />;
  }

  if (modal.type === "rounds") {
    return (
      <RoundsEditor
        title={modal.title}
        rounds={modal.rounds}
        simple={modal.simple}
        seasons={modal.seasons}
        onClose={close}
        onSave={(rounds) => { save(modal.build(rounds)); close(); }}
      />
    );
  }

  return null;
}
