"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Box, ImageIcon, Link2, Trash2, X } from "lucide-react";
import { setArchIcon } from "@/lib/arch/edit";
import { canTone, detailsOf, hasDetails, setDetails, setTone } from "@/lib/compose/edit";
import { TONE_COLORS } from "@/lib/compose/theme";
import { TONES, type DiagramModel, type DiagramNode } from "@/lib/model/types";
import { diagramKind, isEngineLaidOut } from "@/lib/model/kind";
import { deleteItems, renameItem, setIcon } from "@/lib/model/ops";
import { indexModel } from "@/lib/model/query";
import { MODEL_LIMITS } from "@/lib/model/validate";
import { ArchMeaningField, ArchTextField } from "./ArchFields";
import IconPicker from "./IconPicker";
import { Popover } from "./ui/Popover";
import { Button, IconButton } from "./ui/primitives";

export interface ElementEditorProps {
  model: DiagramModel | null;
  selection: string[];
  readOnly: boolean;
  connectFrom: string | null;
  renameRequest?: { id: string; nonce: number };
  onApply(op: (m: DiagramModel) => DiagramModel, options?: { coalesceKey?: string }): void;
  onStartConnect(from: string): void;
  onCancelConnect(): void;
  onDeselect(): void;
}

export default function ElementEditor({ model, selection, readOnly, connectFrom, renameRequest, onApply, onStartConnect, onCancelConnect, onDeselect }: ElementEditorProps) {
  const [labelValue, setLabelValue] = useState("");
  const skipBlurSave = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The draft belongs to the item it was typed for: clicking another item must
  // never rename that one with this text (the selection changes before blur).
  const draftRef = useRef<{ id: string | null; value: string; dirty: boolean }>({ id: null, value: "", dirty: false });
  const handledRename = useRef<number | null>(null);
  const index = model ? indexModel(model) : null;
  const selectedId = selection.length === 1 ? selection[0] : null;
  const selectedNode = selectedId && index ? index.byId.get(selectedId) ?? null : null;
  const selectedEdge = selectedId && index ? index.edgeById.get(selectedId) ?? null : null;
  const selectedLabel = selectedNode?.label ?? selectedEdge?.label ?? "";

  const commitDraft = useCallback(() => {
    const draft = draftRef.current;
    if (!draft.dirty || !draft.id) return;
    draftRef.current = { ...draft, dirty: false };
    const next = draft.value.trim();
    const id = draft.id;
    if (next) onApply((m) => renameItem(m, id, next), { coalesceKey: `rename:${id}` });
  }, [onApply]);

  useEffect(() => {
    // A pending edit for the previous selection is saved to that item before switching.
    if (draftRef.current.id !== selectedId) commitDraft();
    else if (draftRef.current.dirty) return;
    draftRef.current = { id: selectedId, value: selectedLabel, dirty: false };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLabelValue(selectedLabel);
  }, [commitDraft, selectedId, selectedLabel]);

  useEffect(() => {
    if (!renameRequest || renameRequest.id !== selectedId || handledRename.current === renameRequest.nonce) return;
    handledRename.current = renameRequest.nonce;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renameRequest, selectedId]);

  const save = useCallback(() => {
    if (skipBlurSave.current) {
      skipBlurSave.current = false;
      return;
    }
    commitDraft();
  }, [commitDraft]);

  const discardDraft = useCallback(() => {
    draftRef.current = { ...draftRef.current, value: selectedLabel, dirty: false };
    setLabelValue(selectedLabel);
  }, [selectedLabel]);

  if (readOnly || !model) return null;

  if (connectFrom) {
    return (
      <div className="absolute bottom-16 left-1/2 z-20 flex -translate-x-1/2 animate-slide-up items-center gap-3 rounded-xl bg-indigo-600 px-4 py-2 text-[13px] text-white shadow-lg">
        <span className="size-2 animate-pulse-soft rounded-full bg-white" />
        Click the target node to connect
        <button type="button" onClick={onCancelConnect} className="rounded-md bg-white/15 px-2 py-0.5 text-xs hover:bg-white/25">Cancel</button>
      </div>
    );
  }

  if (selection.length === 0) return null;

  if (selection.length > 1) {
    return (
      <div className="absolute bottom-16 left-1/2 z-20 w-[min(440px,calc(100%-2rem))] -translate-x-1/2 animate-slide-up rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800"><Box className="size-3.5" /></span>
          <span className="min-w-0 flex-1 text-[13px] font-medium text-zinc-700 dark:text-zinc-200">{selection.length} items selected</span>
          <IconButton label="Deselect (Esc)" size="sm" onClick={onDeselect}><X className="size-3.5" /></IconButton>
          <IconButton label="Delete" onClick={() => onApply((m) => deleteItems(m, selection))} className="hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-500/10"><Trash2 className="size-4" /></IconButton>
        </div>
      </div>
    );
  }

  if (!selectedId || (!selectedNode && !selectedEdge)) return null;
  const isEdge = Boolean(selectedEdge);
  const architecture = diagramKind(model) === "architecture";
  // Generated page nodes (the title) can only be renamed.
  const generated = Boolean(selectedNode?.generated);
  const name = selectedEdge ? `${selectedEdge.from} -> ${selectedEdge.to}` : generated ? "Diagram title" : selectedNode?.id ?? selectedId;
  // Architecture boundaries take their icon from the platform's conventions.
  const canPickIcon = Boolean(selectedNode) && !generated && !(architecture && selectedNode?.container);

  return (
    <div className="absolute bottom-16 left-1/2 z-20 w-[min(440px,calc(100%-2rem))] -translate-x-1/2 animate-slide-up rounded-2xl border border-zinc-200 bg-white/95 p-3 shadow-xl backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
          {isEdge ? <ArrowRight className="size-3.5" /> : <Box className="size-3.5" />}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400" title={name}>{name}</span>
        <IconButton label="Deselect (Esc)" size="sm" onClick={onDeselect}><X className="size-3.5" /></IconButton>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          ref={inputRef}
          value={labelValue}
          onChange={(e) => {
            const value = e.target.value;
            setLabelValue(value);
            draftRef.current = { id: selectedId, value, dirty: value.trim() !== selectedLabel };
          }}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
              skipBlurSave.current = true;
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              skipBlurSave.current = true;
              discardDraft();
              e.currentTarget.blur();
            }
          }}
          placeholder="Label"
          aria-label="Label"
          maxLength={MODEL_LIMITS.labelLength}
          className="h-8 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
        />
        {selectedNode && canPickIcon && (
          <Popover align="end" panelClassName="p-0" trigger={({ open, toggle, id }) => (
            <IconButton label="Change icon" onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}><ImageIcon className="size-4" /></IconButton>
          )}>
            {(close) => <IconPicker value={selectedNode.icon} allowNone autoFocus onSelect={(nextIcon) => {
              // Architecture components keep the icon's registry key, which the spec and exports use.
              onApply((m) => (architecture ? setArchIcon(m, selectedNode.id, iconKeyOf(nextIcon)) : setIcon(m, selectedNode.id, nextIcon)), { coalesceKey: `icon:${selectedNode.id}` });
              close();
            }} />}
          </Popover>
        )}
        {selectedNode && !generated && <IconButton label="Connect to another node" onClick={() => onStartConnect(selectedNode.id)}><Link2 className="size-4" /></IconButton>}
        {!generated && <IconButton label="Delete" onClick={() => onApply((m) => deleteItems(m, [selectedId]))} className="hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-500/10"><Trash2 className="size-4" /></IconButton>}
      </div>
      {selectedNode && diagramKind(model) === "poster" && hasDetails(selectedNode) && <ComposedFields key={selectedNode.id} node={selectedNode} onApply={onApply} />}
      {architecture && selectedNode && (selectedNode.role === "service" || selectedNode.role === "boundary") && <ArchTextField key={selectedNode.id} node={selectedNode} onApply={onApply} />}
      {architecture && selectedEdge && <ArchMeaningField edge={selectedEdge} onApply={onApply} />}
      {selectedNode && !generated && (
        <p className="mt-2 text-[11px] text-zinc-400">
          {isEngineLaidOut(model) ? "Tip: moved items snap back into the layout with Tidy up." : "Tip: drag the selected node onto another container to move it."}
        </p>
      )}
      {selectedEdge && <div className="mt-2"><Button variant="ghost" size="xs" onClick={() => onApply((m) => deleteItems(m, [selectedEdge.id]))}>Delete connection</Button></div>}
    </div>
  );
}

function iconKeyOf(url: string | undefined): string | undefined {
  return url?.match(/^\/icons\/([a-z0-9-]+)\.svg$/)?.[1];
}

const DETAILS_LABEL: Record<string, string> = {
  card: "Details, one per line",
  step: "Details, one per line",
  lane: "Trigger (route, topic, schedule)",
  banner: "Detail",
  header: "Subtitle",
  footer: "Outcome",
};

/** Detail text and colour of a composed item. Keyed by node id, so a draft never lands on another item. */
function ComposedFields({ node, onApply }: { node: DiagramNode; onApply: ElementEditorProps["onApply"] }) {
  const saved = detailsOf(node);
  // `base` is the saved text the draft started from: when undo, redo or an AI edit changes the
  // text under an unedited field, the field follows; an edit in progress is kept.
  const [draft, setDraft] = useState({ base: saved, value: saved });
  if (draft.base !== saved && draft.value === draft.base) setDraft({ base: saved, value: saved });
  const pending = useRef({ id: node.id, value: draft.value, dirty: false, onApply });
  useEffect(() => {
    pending.current = { id: node.id, value: draft.value, dirty: draft.value !== saved, onApply };
  });
  // Clicking another item unmounts this field before blur fires: save what was typed.
  useEffect(
    () => () => {
      const { id, value, dirty, onApply: apply } = pending.current;
      if (dirty) apply((m) => setDetails(m, id, value), { coalesceKey: `details:${id}` });
    },
    [],
  );
  const commit = () => {
    if (draft.value === saved) return;
    onApply((m) => setDetails(m, node.id, draft.value), { coalesceKey: `details:${node.id}` });
    pending.current = { ...pending.current, dirty: false };
    setDraft((d) => ({ base: d.value, value: d.value }));
  };
  const multiline = node.role === "card" || node.role === "step";
  return (
    <div className="mt-2 space-y-2">
      <textarea
        value={draft.value}
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
          } else if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        rows={multiline ? 3 : 1}
        aria-label={DETAILS_LABEL[node.role ?? ""] ?? "Details"}
        placeholder={DETAILS_LABEL[node.role ?? ""] ?? "Details"}
        className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] leading-snug text-zinc-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      />
      {canTone(node) && (
        <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1.5">
          {TONES.map((tone) => (
            <button
              key={tone}
              type="button"
              role="radio"
              aria-checked={node.tone === tone}
              aria-label={tone}
              title={tone}
              onClick={() => onApply((m) => setTone(m, node.id, tone))}
              className="size-5 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/70 aria-checked:ring-2 aria-checked:ring-zinc-400 aria-checked:ring-offset-1 dark:aria-checked:ring-offset-zinc-900"
              style={{ background: TONE_COLORS[tone].fill, borderColor: TONE_COLORS[tone].main }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
