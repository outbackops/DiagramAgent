"use client";

import { useEffect, useMemo, useState } from "react";
import { AlignCenter, AlignEndHorizontal, AlignHorizontalJustifyCenter, AlignHorizontalSpaceAround, AlignStartHorizontal, AlignVerticalJustifyCenter, AlignVerticalSpaceAround, Box, Link2, Plus, Redo2, Rows3, Sparkles, Trash2, Undo2 } from "lucide-react";
import type { DiagramModel } from "@/lib/model/types";
import { addGroup, addNode, alignItems, deleteItems, distributeItems } from "@/lib/model/ops";
import { indexModel, isGroup } from "@/lib/model/query";
import IconPicker from "./IconPicker";
import { MenuItem, Popover } from "./ui/Popover";
import { Button, IconButton, Spinner, cn } from "./ui/primitives";
import { useToast } from "./ui/Toast";

type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

function focusedInTextInput(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return Boolean(el.closest('input, textarea, [contenteditable="true"]'));
}

export default function CanvasToolbar({
  model,
  selection,
  readOnly,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onApply,
  onSelectionChange,
  onStartConnect,
  onTidyUp,
}: {
  model: DiagramModel | null;
  selection: string[];
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo(): void;
  onRedo(): void;
  onApply(op: (m: DiagramModel) => DiagramModel, options?: { coalesceKey?: string }): void;
  onSelectionChange(ids: string[]): void;
  onStartConnect(from: string): void;
  onTidyUp(): Promise<void>;
}) {
  const { toast } = useToast();
  const [label, setLabel] = useState("New node");
  const [icon, setIcon] = useState<string | undefined>();
  const [tidying, setTidying] = useState(false);
  const disabled = readOnly || !model;
  const index = useMemo(() => (model ? indexModel(model) : null), [model]);
  const selectedNodes = selection.filter((id) => index?.byId.has(id));
  const oneSelectedNode = selectedNodes.length === 1 ? index?.byId.get(selectedNodes[0]) ?? null : null;
  const canConnect = Boolean(oneSelectedNode && !oneSelectedNode.container) && !disabled;
  const canAlign = selectedNodes.length >= 2 && !disabled;
  const canDistribute = selectedNodes.length >= 3 && !disabled;
  const canDelete = selection.length > 0 && !disabled;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (readOnly || focusedInTextInput(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey && canUndo) {
        e.preventDefault();
        onUndo();
      } else if (((key === "z" && e.shiftKey) || key === "y") && canRedo) {
        e.preventDefault();
        onRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canRedo, canUndo, onRedo, onUndo, readOnly]);

  const addNewNode = () => {
    const name = label.trim() || "New node";
    const parent = oneSelectedNode && index && isGroup(index, oneSelectedNode.id) ? oneSelectedNode.id : null;
    const near = oneSelectedNode && !oneSelectedNode.container ? oneSelectedNode.id : undefined;
    let newId = "";
    onApply((m) => {
      const result = addNode(m, { parent, label: name, icon, near });
      newId = result.id;
      return result.model;
    });
    if (newId) onSelectionChange([newId]);
    setLabel("New node");
    setIcon(undefined);
  };

  const addNewGroup = () => {
    let newId = "";
    const canWrap = selectedNodes.length > 0 && selectedNodes.every((id) => index?.byId.get(id)?.parent === index?.byId.get(selectedNodes[0])?.parent);
    const parent = canWrap ? (index?.byId.get(selectedNodes[0])?.parent ?? null) : null;
    onApply((m) => {
      const result = addGroup(m, { parent, label: "New group", wrap: canWrap ? selectedNodes : undefined });
      newId = result.id;
      return result.model;
    });
    if (newId) onSelectionChange([newId]);
  };

  const runTidy = async () => {
    setTidying(true);
    try {
      await onTidyUp();
    } catch (err) {
      toast({ tone: "error", title: "Tidy up failed", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setTidying(false);
    }
  };

  const align = (mode: AlignMode) => onApply((m) => alignItems(m, selectedNodes, mode), { coalesceKey: `align:${mode}` });

  return (
    <div className={cn("flex items-center gap-1 rounded-2xl border border-zinc-200 bg-white/90 p-1 shadow-lg backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90", disabled && "opacity-75")} aria-label="Canvas toolbar">
      <IconButton label="Undo (Ctrl+Z)" size="sm" disabled={disabled || !canUndo} onClick={onUndo}><Undo2 className="size-3.5" /></IconButton>
      <IconButton label="Redo (Ctrl+Shift+Z)" size="sm" disabled={disabled || !canRedo} onClick={onRedo}><Redo2 className="size-3.5" /></IconButton>
      <div className="mx-0.5 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
      <Popover align="start" panelClassName="w-80 p-3" trigger={({ open, toggle, id }) => (
        <IconButton label="Add node" size="sm" disabled={disabled} onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}><Plus className="size-3.5" /></IconButton>
      )}>
        {(close) => <div className="space-y-2">
          <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 h-8 w-full rounded-lg border border-zinc-200 bg-white px-2 text-[13px] dark:border-zinc-700 dark:bg-zinc-950" />
          </label>
          <IconPicker value={icon} onSelect={setIcon} allowNone />
          <Button variant="primary" className="w-full" onClick={() => { addNewNode(); close(); }}>Add node</Button>
        </div>}
      </Popover>
      <IconButton label="Add group" size="sm" disabled={disabled} onClick={addNewGroup}><Box className="size-3.5" /></IconButton>
      <IconButton label="Connect" size="sm" disabled={!canConnect || !oneSelectedNode} onClick={() => oneSelectedNode && onStartConnect(oneSelectedNode.id)}><Link2 className="size-3.5" /></IconButton>
      <Popover align="start" panelClassName="w-44 p-1.5" trigger={({ open, toggle, id }) => (
        <IconButton label="Align selected items" size="sm" disabled={!canAlign} onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}><AlignCenter className="size-3.5" /></IconButton>
      )}>
        {(close) => <div role="menu" aria-label="Align">
          {([
            ["left", "Left", <AlignStartHorizontal key="i" className="size-3.5" />],
            ["center", "Center", <AlignHorizontalJustifyCenter key="i" className="size-3.5" />],
            ["right", "Right", <AlignEndHorizontal key="i" className="size-3.5" />],
            ["top", "Top", <Rows3 key="i" className="size-3.5" />],
            ["middle", "Middle", <AlignVerticalJustifyCenter key="i" className="size-3.5" />],
            ["bottom", "Bottom", <Rows3 key="i" className="size-3.5 rotate-180" />],
          ] as const).map(([mode, text, iconNode]) => <MenuItem key={mode} icon={iconNode} onSelect={() => { align(mode); close(); }}>{text}</MenuItem>)}
        </div>}
      </Popover>
      <Popover align="start" panelClassName="w-48 p-1.5" trigger={({ open, toggle, id }) => (
        <IconButton label="Distribute selected items" size="sm" disabled={!canDistribute} onClick={toggle} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}><AlignHorizontalSpaceAround className="size-3.5" /></IconButton>
      )}>
        {(close) => <div role="menu" aria-label="Distribute">
          <MenuItem icon={<AlignHorizontalSpaceAround className="size-3.5" />} onSelect={() => { onApply((m) => distributeItems(m, selectedNodes, "horizontal"), { coalesceKey: "distribute:horizontal" }); close(); }}>Horizontal</MenuItem>
          <MenuItem icon={<AlignVerticalSpaceAround className="size-3.5" />} onSelect={() => { onApply((m) => distributeItems(m, selectedNodes, "vertical"), { coalesceKey: "distribute:vertical" }); close(); }}>Vertical</MenuItem>
        </div>}
      </Popover>
      <IconButton label="Delete (Del)" size="sm" disabled={!canDelete} onClick={() => onApply((m) => deleteItems(m, selection))} className="hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-500/10"><Trash2 className="size-3.5" /></IconButton>
      <div className="mx-0.5 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
      <Button variant="ghost" size="xs" disabled={disabled || tidying} onClick={() => void runTidy()} icon={tidying ? <Spinner className="size-3" /> : <Sparkles className="size-3.5" />}>Tidy up</Button>
    </div>
  );
}
