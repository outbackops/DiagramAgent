"use client";

import { useEffect, useRef, useState } from "react";
import { setArchDetail, setArchFacts, setArchMeaning } from "@/lib/arch/edit";
import { ARCH_LIMITS, MEANINGS, type Meaning } from "@/lib/arch/spec";
import type { DiagramEdge, DiagramModel, DiagramNode } from "@/lib/model/types";

type Apply = (op: (m: DiagramModel) => DiagramModel, options?: { coalesceKey?: string }) => void;

const MEANING_LABEL: Record<Meaning, string> = {
  request: "Request",
  async: "Async message",
  replication: "Replication",
  "private-link": "Private link",
  peering: "Peering",
  vpn: "VPN or private circuit",
  monitoring: "Monitoring",
  management: "Management",
  egress: "Egress",
};

const FIELD_CLASS =
  "w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] leading-snug text-zinc-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

/**
 * The detail line of a component (SKU, tier, count, port) or the facts of a boundary (address
 * range, region, zone). Keyed by node id by the caller, so a draft never lands on another item.
 */
export function ArchTextField({ node, onApply }: { node: DiagramNode; onApply: Apply }) {
  const boundary = node.role === "boundary";
  const saved = (boundary ? node.arch?.facts : node.arch?.detail) ?? "";
  const set = boundary ? setArchFacts : setArchDetail;
  const coalesceKey = `${boundary ? "facts" : "detail"}:${node.id}`;
  // `base` is the saved text the draft started from: when undo, redo or an AI edit changes the
  // text under an unedited field, the field follows; an edit in progress is kept.
  const [draft, setDraft] = useState({ base: saved, value: saved });
  if (draft.base !== saved && draft.value === draft.base) setDraft({ base: saved, value: saved });
  const pending = useRef({ id: node.id, value: draft.value, dirty: false, onApply, set, coalesceKey });
  useEffect(() => {
    pending.current = { id: node.id, value: draft.value, dirty: draft.value !== saved, onApply, set, coalesceKey };
  });
  // Clicking another item unmounts this field before blur fires: save what was typed.
  useEffect(
    () => () => {
      const last = pending.current;
      if (last.dirty) last.onApply((m) => last.set(m, last.id, last.value), { coalesceKey: last.coalesceKey });
    },
    [],
  );
  const commit = () => {
    if (draft.value === saved) return;
    onApply((m) => set(m, node.id, draft.value), { coalesceKey });
    pending.current = { ...pending.current, dirty: false };
    setDraft((d) => ({ base: d.value, value: d.value }));
  };
  const label = boundary ? "Facts: address range, region or zone" : "Detail: SKU, tier, count or port";
  return (
    <input
      value={draft.value}
      maxLength={boundary ? ARCH_LIMITS.factsChars : ARCH_LIMITS.detailChars}
      onChange={(e) => {
        const value = e.target.value;
        setDraft((d) => ({ ...d, value }));
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setDraft({ base: saved, value: saved });
        } else if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      aria-label={label}
      placeholder={label}
      className={`mt-2 ${FIELD_CLASS}`}
    />
  );
}

/** What a connection means: its line style, arrowheads and legend entry follow. */
export function ArchMeaningField({ edge, onApply }: { edge: DiagramEdge; onApply: Apply }) {
  return (
    <label className="mt-2 flex items-center gap-2 text-[12px] text-zinc-600 dark:text-zinc-300">
      <span className="shrink-0">Meaning</span>
      <select
        value={edge.meaning ?? "request"}
        onChange={(e) => {
          // Read the choice now: the op runs later, after React has reset this controlled select.
          const meaning = e.target.value as Meaning;
          onApply((m) => setArchMeaning(m, edge.id, meaning));
        }}
        className={FIELD_CLASS}
      >
        {MEANINGS.map((meaning) => (
          <option key={meaning} value={meaning}>
            {MEANING_LABEL[meaning]}
          </option>
        ))}
      </select>
    </label>
  );
}
