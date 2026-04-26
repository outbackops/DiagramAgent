import { describe, it, expect } from "vitest";
import { parseD2 } from "./d2-to-drawio";

/**
 * parseD2 parses the strict D2 dialect emitted by the DiagramAgent system
 * prompt. It does NOT cover the full D2 language. Tests stay aligned with
 * what generated diagrams actually look like (Name: { label: ...; ... }).
 */
describe("parseD2", () => {
  it("parses an empty input as an empty diagram", () => {
    const r = parseD2("");
    expect(r.nodes).toEqual([]);
    expect(r.connections).toEqual([]);
    expect(typeof r.classes).toBe("object");
  });

  it("parses single-line block nodes with inline label and icon", () => {
    const code = [
      "WebApp: { label: Web Application; icon: aws.ec2 }",
      "Database: { label: Postgres; icon: aws.rds }",
    ].join("\n");
    const r = parseD2(code);
    expect(r.nodes.length).toBe(2);
    expect(r.nodes[0].id).toBe("WebApp");
    expect(r.nodes[0].label).toBe("Web Application");
    expect(r.nodes[0].icon).toBe("aws.ec2");
    expect(r.nodes[1].id).toBe("Database");
    expect(r.nodes[1].label).toBe("Postgres");
  });

  it("parses connections with `->` and labels", () => {
    const code = [
      "A: { label: A }",
      "B: { label: B }",
      "A -> B: calls",
    ].join("\n");
    const r = parseD2(code);
    expect(r.connections.length).toBe(1);
    expect(r.connections[0].from).toBe("A");
    expect(r.connections[0].to).toBe("B");
    expect(r.connections[0].label).toBe("calls");
    expect(r.connections[0].dashed).toBe(false);
  });

  it("recognises dashed connections via stroke-dash style block", () => {
    const code = [
      "A: { label: A }",
      "B: { label: B }",
      "A -> B: async {",
      "  style.stroke-dash: 3",
      "}",
    ].join("\n");
    const r = parseD2(code);
    expect(r.connections.length).toBe(1);
    expect(r.connections[0].dashed).toBe(true);
  });

  it("parses multi-line nested containers with children flagged as such", () => {
    const code = [
      "Cloud: {",
      "  label: AWS Cloud",
      "  Web: { label: Web Tier; icon: aws.alb }",
      "  DB: { label: Database; icon: aws.rds }",
      "}",
    ].join("\n");
    const r = parseD2(code);
    expect(r.nodes.length).toBe(1);
    const cloud = r.nodes[0];
    expect(cloud.id).toBe("Cloud");
    expect(cloud.isContainer).toBe(true);
    expect(cloud.children.length).toBe(2);
    expect(cloud.children.map((c) => c.id).sort()).toEqual(["DB", "Web"]);
    // Inner labels honoured
    const web = cloud.children.find((c) => c.id === "Web")!;
    expect(web.label).toBe("Web Tier");
  });

  it("attaches class assignments to nodes (Name.class: className)", () => {
    const code = [
      "Web: { label: Web Server; icon: aws.ec2 }",
      "Web.class: compute",
    ].join("\n");
    const r = parseD2(code);
    expect(r.nodes[0].className).toBe("compute");
  });

  it("parses connections that span containers using dotted paths", () => {
    const code = [
      "Cloud: {",
      "  Web: { label: Web; icon: aws.ec2 }",
      "}",
      "User: { label: User; icon: aws.users }",
      "User -> Cloud.Web: hits",
    ].join("\n");
    const r = parseD2(code);
    expect(r.connections.length).toBe(1);
    expect(r.connections[0].from).toBe("User");
    expect(r.connections[0].to).toBe("Cloud.Web");
    expect(r.connections[0].label).toBe("hits");
  });

  it("returns the default class palette merged into classes", () => {
    const r = parseD2("");
    expect(Object.keys(r.classes).length).toBeGreaterThan(0);
    for (const def of Object.values(r.classes)) {
      expect(typeof def.fill).toBe("string");
      expect(typeof def.stroke).toBe("string");
    }
  });

  it("ignores comments and direction directives", () => {
    const code = [
      "# this is a comment",
      "direction: right",
      "A: { label: A }",
    ].join("\n");
    const r = parseD2(code);
    expect(r.nodes.length).toBe(1);
    expect(r.nodes[0].id).toBe("A");
  });

  it("survives malformed lines without throwing", () => {
    const code = [
      "{{{ malformed",
      "A: { label: A }",
      "}}} also bad",
    ].join("\n");
    expect(() => parseD2(code)).not.toThrow();
  });
});
