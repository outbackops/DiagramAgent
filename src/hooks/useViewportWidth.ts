"use client";

import { useEffect, useState } from "react";

/** Current window width (defaults to a desktop width during SSR). */
export function useViewportWidth(fallback = 1440): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}
