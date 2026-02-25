"use client";

import { useState, useCallback, useEffect } from "react";

export interface SelectedElement {
  path: string;
  isConnection: boolean;
  connectionFrom?: string;
  connectionTo?: string;
  label?: string;
}

interface ElementEditorProps {
  selected: SelectedElement | null;
  /** Whether we're waiting for the user to pick a second node for a new connection */
  connectMode: boolean;
  onUpdateLabel: (path: string, newLabel: string, isConnection: boolean) => void;
  onDelete: (path: string, isConnection: boolean) => void;
  onStartConnect: () => void;
  onCancelConnect: () => void;
  onDeselect: () => void;
}

export default function ElementEditor({
  selected,
  connectMode,
  onUpdateLabel,
  onDelete,
  onStartConnect,
  onCancelConnect,
  onDeselect,
}: ElementEditorProps) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState("");

  // Reset editing state when selection changes
  useEffect(() => {
    setEditingLabel(false);
    setLabelValue(selected?.label || "");
  }, [selected]);

  const handleLabelSave = useCallback(() => {
    if (selected && labelValue.trim()) {
      onUpdateLabel(selected.path, labelValue.trim(), selected.isConnection);
    }
    setEditingLabel(false);
  }, [selected, labelValue, onUpdateLabel]);

  const handleLabelKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleLabelSave();
      if (e.key === "Escape") {
        setEditingLabel(false);
        setLabelValue(selected?.label || "");
      }
    },
    [handleLabelSave, selected]
  );

  // Connect mode banner
  if (connectMode) {
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 text-sm animate-in fade-in slide-in-from-bottom-2">
        <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
        <span>Click a target node to create a connection</span>
        <button
          onClick={onCancelConnect}
          className="px-2 py-0.5 bg-blue-500 hover:bg-blue-400 rounded text-xs transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (!selected) return null;

  const displayName = selected.isConnection
    ? `${selected.connectionFrom} → ${selected.connectionTo}`
    : selected.path;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl px-4 py-3 min-w-[320px] max-w-[480px] animate-in fade-in slide-in-from-bottom-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {selected.isConnection ? (
            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          )}
          <span className="text-xs font-mono text-gray-500 dark:text-gray-400 truncate max-w-[200px]" title={displayName}>
            {displayName}
          </span>
        </div>
        <button
          onClick={onDeselect}
          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          title="Deselect"
        >
          <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Label editor */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-gray-500 dark:text-gray-400 w-12 shrink-0">Label:</span>
        {editingLabel ? (
          <div className="flex-1 flex gap-1.5">
            <input
              type="text"
              value={labelValue}
              onChange={(e) => setLabelValue(e.target.value)}
              onKeyDown={handleLabelKeyDown}
              onBlur={handleLabelSave}
              autoFocus
              className="flex-1 px-2 py-1 text-xs bg-gray-50 dark:bg-gray-900 border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800 dark:text-gray-200"
            />
          </div>
        ) : (
          <button
            onClick={() => {
              setLabelValue(selected.label || "");
              setEditingLabel(true);
            }}
            className="flex-1 text-left px-2 py-1 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded hover:border-blue-400 transition-colors text-gray-700 dark:text-gray-300 truncate"
            title="Click to edit label"
          >
            {selected.label || "(no label)"}
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-gray-100 dark:border-gray-700">
        {!selected.isConnection && (
          <button
            onClick={onStartConnect}
            className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
            Connect to...
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={() => onDelete(selected.path, selected.isConnection)}
          className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Delete
        </button>
      </div>
    </div>
  );
}
