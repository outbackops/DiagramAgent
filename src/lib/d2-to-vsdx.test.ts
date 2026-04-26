import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { d2ToVsdx } from "./d2-to-vsdx";

/**
 * d2ToVsdx is the native Visio (.vsdx) exporter — a true Open Packaging
 * Conventions (OPC) zip with [Content_Types].xml, _rels/, and
 * visio/pages/page1.xml. These tests exercise the end-to-end pipeline
 * (parseD2 → layout → XML → zip) and verify package shape.
 */
describe("d2ToVsdx", () => {
  async function load(buf: Buffer): Promise<JSZip> {
    return await JSZip.loadAsync(buf);
  }

  it("produces a valid OPC zip with the required package parts", async () => {
    const buf = await d2ToVsdx("A: { label: A }\nB: { label: B }\nA -> B");
    const zip = await load(buf);

    // PK signature: every legitimate zip starts with 0x50 0x4B 0x03 0x04
    expect(buf.slice(0, 2).toString("hex")).toBe("504b");

    // Required parts of a minimal Visio .vsdx package
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
    expect(zip.file("_rels/.rels")).not.toBeNull();
    expect(zip.file("visio/document.xml")).not.toBeNull();
    expect(zip.file("visio/pages/page1.xml")).not.toBeNull();
  });

  it("renders nodes as Shape elements in page1.xml", async () => {
    const buf = await d2ToVsdx([
      "Web: { label: Web Server }",
      "DB: { label: Database }",
    ].join("\n"));
    const zip = await load(buf);
    const page = await zip.file("visio/pages/page1.xml")!.async("string");

    expect(page).toContain("<Shape");
    // Both labels must appear, XML-escaped or plain
    expect(page).toContain("Web Server");
    expect(page).toContain("Database");
  });

  it("renders connections as Connect entries", async () => {
    const buf = await d2ToVsdx([
      "A: { label: A }",
      "B: { label: B }",
      "A -> B: calls",
    ].join("\n"));
    const zip = await load(buf);
    const page = await zip.file("visio/pages/page1.xml")!.async("string");

    expect(page).toContain("<Connects>");
    expect(page).toContain("</Connects>");
    expect(page).toContain("calls");
  });

  it("survives empty input without throwing and still emits a valid package", async () => {
    const buf = await d2ToVsdx("");
    const zip = await load(buf);
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
    expect(zip.file("visio/pages/page1.xml")).not.toBeNull();
  });

  it("XML-escapes node labels containing special characters", async () => {
    const buf = await d2ToVsdx("Bad: { label: A & B <C> }");
    const zip = await load(buf);
    const page = await zip.file("visio/pages/page1.xml")!.async("string");

    // The raw `&` must not appear unescaped — should be `&amp;`
    expect(page).toContain("A &amp; B");
    expect(page).not.toContain("A & B");
  });

  it("keeps containers and their children in the same package", async () => {
    const buf = await d2ToVsdx([
      "Cloud: {",
      "  label: AWS Cloud",
      "  Web: { label: Web; icon: aws.alb }",
      "  DB: { label: Database; icon: aws.rds }",
      "}",
    ].join("\n"));
    const zip = await load(buf);
    const page = await zip.file("visio/pages/page1.xml")!.async("string");
    expect(page).toContain("AWS Cloud");
    expect(page).toContain("Web");
    expect(page).toContain("Database");
  });
});
