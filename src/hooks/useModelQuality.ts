"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { DiagramModel } from "@/lib/model/types";
import type { QualityReport } from "@/lib/quality/diagram-quality";

export function useModelQuality(model: DiagramModel | null, enabled: boolean): { quality: QualityReport | null; loading: boolean; error: string | null } {
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!model || !enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuality(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void api.renderModel(model, controller.signal).then(
        (res) => {
          if (controller.signal.aborted) return;
          setQuality(res.quality);
          setLoading(false);
        },
        (err: unknown) => {
          if (controller.signal.aborted) return;
          setQuality(null);
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        },
      );
    }, 600);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, model]);

  return { quality, loading, error };
}
