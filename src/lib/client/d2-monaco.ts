"use client";

import type { Monaco } from "@monaco-editor/react";

let registered = false;

/** Register a lightweight D2 language (Monarch tokenizer) and app-matched themes. */
export function registerD2Language(monaco: Monaco) {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: "d2", extensions: [".d2"], aliases: ["D2", "d2"] });
  monaco.languages.setLanguageConfiguration("d2", {
    comments: { lineComment: "#" },
    brackets: [
      ["{", "}"],
      ["[", "]"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: "{", close: "}" },
      { open: '"', close: '"' },
    ],
    indentationRules: { increaseIndentPattern: /\{\s*$/, decreaseIndentPattern: /^\s*\}/ },
  });

  monaco.languages.setMonarchTokensProvider("d2", {
    keywords: [
      "direction", "label", "icon", "shape", "style", "class", "classes", "near", "tooltip", "link",
      "width", "height", "constraint", "grid-rows", "grid-columns", "grid-gap", "vertical-gap", "horizontal-gap",
      "vars", "layers", "scenarios", "steps", "source-arrowhead", "target-arrowhead", "top", "left",
    ],
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
        [/<->|<-|->|--/, "operator.arrow"],
        [/#[0-9a-fA-F]{3,8}\b/, "number.hex"],
        [/\b\d+(\.\d+)?\b/, "number"],
        [/\b(true|false|null)\b/, "constant"],
        [/\b(style)\.[\w-]+/, "keyword"],
        [/[A-Za-z_][\w-]*(?=\s*:)/, { cases: { "@keywords": "keyword", "@default": "type.identifier" } }],
        [/[{}[\]]/, "delimiter.bracket"],
        [/[:;.]/, "delimiter"],
      ],
    },
  });

  monaco.editor.defineTheme("diagram-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "7c3aed" },
      { token: "type.identifier", foreground: "1d4ed8" },
      { token: "operator.arrow", foreground: "db2777", fontStyle: "bold" },
      { token: "string", foreground: "047857" },
      { token: "number", foreground: "b45309" },
      { token: "number.hex", foreground: "b45309" },
      { token: "comment", foreground: "a1a1aa", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#f4f4f5",
      "editorLineNumber.foreground": "#d4d4d8",
      "editorLineNumber.activeForeground": "#71717a",
    },
  });

  monaco.editor.defineTheme("diagram-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "c4b5fd" },
      { token: "type.identifier", foreground: "93c5fd" },
      { token: "operator.arrow", foreground: "f472b6", fontStyle: "bold" },
      { token: "string", foreground: "6ee7b7" },
      { token: "number", foreground: "fcd34d" },
      { token: "number.hex", foreground: "fcd34d" },
      { token: "comment", foreground: "52525b", fontStyle: "italic" },
    ],
    colors: {
      "editor.background": "#18181b",
      "editor.lineHighlightBackground": "#27272a80",
      "editorLineNumber.foreground": "#3f3f46",
      "editorLineNumber.activeForeground": "#a1a1aa",
    },
  });
}
