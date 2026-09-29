import { describe, expect, it } from "vitest";
import { composeSpec, modelSpecText, recompose } from "./index";
import { canTone, detailsOf, hasDetails, setDetails, setTone } from "./edit";

const spec = {
  title: "Edits",
  columns: [
    { id: "left", title: "Left", items: [{ type: "card", id: "web", title: "Web", lines: ["Browser"], tone: "blue" }] },
    {
      id: "mid",
      title: "Mid",
      size: "wide",
      items: [
        { type: "banner", id: "host", title: "Hosting", text: "Containers" },
        { type: "flow", id: "pay", title: "Pay", subtitle: "POST /pay", tone: "blue", steps: [{ id: "auth", title: "Auth" }, { id: "verify", title: "Verify" }, { id: "charge", title: "Charge", tone: "orange" }] },
      ],
    },
  ],
};

const node = (model: ReturnType<typeof composeSpec>["model"], id: string) => model.nodes.find((n) => n.id === id)!;

describe("composed content edits", () => {
  it("edits card lines and carries them into the spec and a recompose", () => {
    const { model } = composeSpec(spec);
    expect(detailsOf(node(model, "left.web"))).toBe("Browser");
    const edited = setDetails(model, "left.web", "Browser app\n\n  Signs in with SSO  \nthird\nfourth\nfifth\nsixth");
    expect(node(edited, "left.web").content?.lines).toEqual(["Browser app", "Signs in with SSO", "third", "fourth", "fifth"]);
    expect(modelSpecText(edited)).toContain("Signs in with SSO");
    expect(node(recompose(edited).model, "left.web").content?.lines).toContain("Signs in with SSO");
  });

  it("edits the subtitle of banners and lanes, and clears it when empty", () => {
    const { model } = composeSpec(spec);
    expect(detailsOf(node(model, "mid.pay"))).toBe("POST /pay");
    const cleared = setDetails(model, "mid.pay", "   ");
    expect(node(cleared, "mid.pay").content?.subtitle).toBeUndefined();
    expect(node(setDetails(model, "mid.host", "VMs"), "mid.host").content?.subtitle).toBe("VMs");
  });

  it("returns the same model for no-op edits and for nodes without details", () => {
    const { model } = composeSpec(spec);
    expect(setDetails(model, "left.web", "Browser")).toBe(model);
    expect(hasDetails(node(model, "left"))).toBe(false);
    expect(setDetails(model, "left", "x")).toBe(model);
  });

  it("recolours a lane with the steps and step arrows that shared its tone", () => {
    const { model } = composeSpec(spec);
    const green = setTone(model, "mid.pay", "green");
    expect(node(green, "mid.pay").tone).toBe("green");
    expect(node(green, "mid.pay.auth").tone).toBe("green");
    expect(node(green, "mid.pay.charge").tone).toBe("orange");
    expect(node(green, "mid.pay.auth").style.stroke).toBe("#107c10");
    const inside = green.edges.find((e) => e.kind === "step" && e.from === "mid.pay.auth")!;
    expect(inside).toMatchObject({ to: "mid.pay.verify", tone: "green" });
    const intoOrange = green.edges.find((e) => e.kind === "step" && e.from === "mid.pay.verify")!;
    expect(intoOrange.tone).toBe("blue");
    expect(canTone(node(model, "left"))).toBe(false);
    expect(setTone(model, "left", "red")).toBe(model);
  });
});
