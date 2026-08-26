import React from "react";
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
        onSave={(announcement) => {
          const announcements = modal.item
            ? data.announcements.map((item) => item.id === announcement.id ? announcement : item)
            : [announcement, ...data.announcements];
          save({ ...data, announcements });
          close();
        }}
        onDelete={modal.item ? () => {
          save({ ...data, announcements: data.announcements.filter((item) => item.id !== modal.item.id) });
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
