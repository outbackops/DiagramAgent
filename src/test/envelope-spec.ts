import type { ArchConnectionInput, ArchItemInput, ArchSpecInput } from "@/lib/arch/spec";

/**
 * An Architecture spec at the v1 support envelope (ARCH_LIMITS): 60 components, 80 connections and
 * boundaries nested 5 deep (region > VNet > subnet > cluster > namespace), with deterministic extra
 * links between services, managed services and data stores. Used by the layout test and the
 * performance harness (scripts/spikes/arch-envelope-perf.ts).
 */
export function envelopeSpec(): ArchSpecInput {
  const component = (id: string, name: string, icon: string): ArchItemInput => ({ id, name, icon });
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  const namespaces = ["orders", "payments", "catalog"];

  const users = range(3).map((i) => component(`users-${i}`, `User group ${i + 1}`, "users"));
  const partners = range(2).map((i) => component(`partner-${i}`, `Partner API ${i + 1}`, "cloud"));
  const gateways = range(4).map((i) => component(`agw-${i}`, `Application Gateway ${i + 1}`, "azure-application-gateway"));
  const services = namespaces.flatMap((ns) => range(6).map((i) => component(`${ns}-${i}`, `${ns}-svc-${i + 1}`, "k8s-deployment")));
  const data = ["sql-orders", "sql-payments", "sql-catalog", "redis", "cosmos", "search", "storage", "servicebus"].map((id) => component(id, id.replace("-", " "), "azure-sql-database"));
  const endpoints = range(6).map((i) => component(`pe-${i}`, `Private endpoint ${i + 1}`, "azure-private-link"));
  const paas = range(10).map((i) => component(`paas-${i}`, `Managed service ${i + 1}`, "azure-app-service"));
  const shared = ["entra", "monitor", "log-analytics", "key-vault", "defender", "devops", "acr", "dns"].map((id) => component(id, id.replace("-", " "), "azure-monitor"));
  const ingress = component("ingress", "Ingress controller", "k8s-ingress");

  const cluster: ArchItemInput = {
    type: "group",
    kind: "cluster",
    id: "aks",
    name: "AKS cluster",
    items: namespaces.map((ns, n) => ({ type: "group", kind: "namespace", id: `ns-${ns}`, name: ns, items: services.slice(n * 6, n * 6 + 6) })),
  };
  const items: ArchItemInput[] = [
    ...users,
    ...partners,
    {
      type: "group",
      kind: "region",
      id: "region",
      name: "East US",
      items: [
        {
          type: "group",
          kind: "vnet",
          id: "vnet",
          name: "Spoke VNet",
          facts: "10.10.0.0/16",
          items: [
            { type: "group", kind: "subnet", id: "snet-web", name: "Web subnet", facts: "10.10.0.0/24", items: gateways },
            { type: "group", kind: "subnet", id: "snet-app", name: "App subnet", facts: "10.10.1.0/24", items: [ingress, cluster] },
            { type: "group", kind: "subnet", id: "snet-pe", name: "Private endpoints", facts: "10.10.2.0/24", items: endpoints },
          ],
        },
        ...data,
        ...paas,
      ],
    },
    { type: "group", kind: "shared", id: "shared", name: "Shared services", items: shared },
  ];

  const connections: ArchConnectionInput[] = [];
  const seen = new Set<string>();
  const link = (from: string, to: string, label?: string) => {
    const key = `${from}>${to}`;
    if (from === to || seen.has(key) || connections.length >= 80) return;
    seen.add(key);
    connections.push(label ? { from, to, label } : { from, to });
  };
  users.forEach((u, i) => link(u.id!, gateways[i % gateways.length].id!, "HTTPS 443"));
  partners.forEach((p, i) => link(p.id!, gateways[(i + 3) % gateways.length].id!, "HTTPS 443"));
  gateways.forEach((g) => link(g.id!, ingress.id!, "HTTPS"));
  namespaces.forEach((ns) => link(ingress.id!, `${ns}-0`, "HTTP 8080"));
  namespaces.forEach((ns) => range(5).forEach((i) => link(`${ns}-${i}`, `${ns}-${i + 1}`, "gRPC")));
  services.forEach((s, i) => link(s.id!, endpoints[i % endpoints.length].id!, "TDS 1433"));
  endpoints.forEach((e, i) => link(e.id!, data[i].id!, "Private Link"));
  paas.forEach((p, i) => link(services[(i * 5) % services.length].id!, p.id!, "HTTPS"));
  // Deterministic extra links until the envelope's 80.
  let seed = 7;
  const next = (n: number) => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
  const all = [...services, ...paas, ...data];
  while (connections.length < 80) link(all[next(all.length)].id!, all[next(all.length)].id!);

  return { version: 1, title: "Envelope-size platform", platform: "azure", view: "deployment", items, connections };
}
