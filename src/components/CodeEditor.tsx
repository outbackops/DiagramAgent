"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
import { registerD2Language } from "@/lib/client/d2-monaco";
import { Spinner } from "./ui/primitives";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  ),
});

interface CodeEditorProps {
  code: string;
  onChange: (code: string) => void;
  readOnly?: boolean;
  theme: "light" | "dark";
}

export default function CodeEditor({ code, onChange, readOnly = false, theme }: CodeEditorProps) {
  const handleChange = useCallback((value: string | undefined) => onChange(value ?? ""), [onChange]);

  return (
    <MonacoEditor
      height="100%"
      language="d2"
      theme={theme === "dark" ? "diagram-dark" : "diagram-light"}
      value={code}
      onChange={handleChange}
      beforeMount={registerD2Language}
      options={{
        minimap: { enabled: false },
        fontSize: 12.5,
        fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
        lineNumbers: "on",
        wordWrap: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        padding: { top: 10, bottom: 10 },
        renderLineHighlight: "line",
        smoothScrolling: true,
        readOnly,
        domReadOnly: readOnly,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
        overviewRulerLanes: 0,
        guides: { indentation: true },
      }}
    />
  );
}
