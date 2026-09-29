import { describe, it, expect } from "vitest";
import { countObstacleHits, isOrthogonalRoute, routeOrthogonal } from "./d2-routes";

describe("isOrthogonalRoute", () => {
  it("treats axis-aligned routes with small rounded corners as orthogonal", () => {
    expect(
      isOrthogonalRoute([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 104, y: 1 },
        { x: 108, y: 8 },
        { x: 108, y: 200 },
      ]),
    ).toBe(true);
    expect(
      isOrthogonalRoute([
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ]),
    ).toBe(false);
  });
});

describe("routeOrthogonal", () => {
  it("picks a split that avoids obstacles", () => {
    // Blocks the midpoint split (x = 50) below y = 20; only a late split clears it.
    const blocker = { x: 40, y: 20, w: 20, h: 100 };
    const route = routeOrthogonal({ x: 0, y: 0 }, { x: 100, y: 100 }, [blocker]);
    expect(countObstacleHits(route, [blocker])).toBe(0);
    expect(isOrthogonalRoute(route)).toBe(true);
    expect(route[0]).toEqual({ x: 0, y: 0 });
    expect(route.at(-1)).toEqual({ x: 100, y: 100 });
  });
});
