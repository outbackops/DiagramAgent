"use client";

import { forwardRef, useEffect, useRef, type ReactNode } from "react";
import { Boxes, Cloud, Database, GitBranch, Info, Network, Radio, Server, Sparkles, TriangleAlert, Workflow } from "lucide-react";
import type { AgentBusy, ChatItem, ClarifyState, RunRecord } from "@/hooks/useDiagramAgent";
import type { CatalogModel } from "@/lib/llm/types";
import ClarifyPanel, { type ClarifyAnswers } from "./ClarifyPanel";
import Composer, { type ComposerHandle } from "./Composer";
import RunCard from "./RunCard";
import { Spinner, cn } from "./ui/primitives";

export const EXAMPLES: Array<{ title: string; tag: string; icon: ReactNode; prompt: string }> = [
  {
    title: "SQL Always On with DR",
    tag: "Azure",
    icon: <Database className="size-4" />,
    prompt:
      "SQL Server Always On availability group on Azure VMs across a primary and a DR region, with an AG listener, internal load balancers, file-share witness, backups to blob storage, and Azure Monitor.",
  },
  {
    title: "Three-tier web app",
    tag: "AWS",
    icon: <Server className="size-4" />,
    prompt: "Three-tier web application on AWS: CloudFront and WAF, an ALB, an EC2 auto scaling group across two AZs, RDS PostgreSQL Multi-AZ, and ElastiCache Redis.",
  },
  {
    title: "Kubernetes microservices",
    tag: "K8s",
    icon: <Boxes className="size-4" />,
    prompt:
      "Microservices on Kubernetes: ingress controller, service mesh with mTLS, four services (orders, payments, catalog, users) with their own databases, Kafka for events, and Prometheus + Grafana observability.",
  },
  {
    title: "Serverless event-driven",
    tag: "AWS",
    icon: <Workflow className="size-4" />,
    prompt: "Serverless event-driven order processing on AWS with API Gateway, Lambda, SQS, EventBridge, DynamoDB, S3, and CloudWatch.",
  },
  {
    title: "CI/CD to AKS",
    tag: "DevOps",
    icon: <GitBranch className="size-4" />,
    prompt:
      "CI/CD pipeline with GitHub Actions that builds containers, scans them, pushes to Azure Container Registry, and deploys to AKS with Helm, using Key Vault for secrets and staging/production environments.",
  },
  {
    title: "Hub-and-spoke network",
    tag: "Azure",
    icon: <Network className="size-4" />,
    prompt:
      "Azure hub-and-spoke network: hub VNet with Azure Firewall, VPN gateway to on-premises and Bastion; two spoke VNets (web and data) peered to the hub, with private endpoints for Azure SQL and Storage.",
  },
  {
    title: "RAG chat app",
    tag: "AI",
    icon: <Sparkles className="size-4" />,
    prompt:
      "Retrieval-augmented generation chat app on Azure: App Service front end, Azure OpenAI, Azure AI Search index fed from Blob Storage by an indexing Function, Cosmos DB chat history, and Entra ID sign-in.",
  },
  {
    title: "Streaming data platform",
    tag: "Data",
    icon: <Radio className="size-4" />,
    prompt:
      "Real-time analytics: producers publish to Kafka, Spark Structured Streaming processes events into a data lake (bronze/silver/gold), a warehouse serves BI dashboards, with a schema registry and monitoring.",
  },
];

function EmptyState({ onPick, disabled }: { onPick: (prompt: string) => void; disabled: boolean }) {
  return (
    <div className="animate-fade-in px-1 pb-4 pt-6">
      <div className="mb-5 flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-500/25">
        <Cloud className="size-5" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">What should we diagram?</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        Describe a system in plain language. Name a cloud provider for provider-specific icons, or keep it generic for a vendor-neutral view. You can
        refine the result by chatting, editing the D2 code, or clicking elements on the canvas.
      </p>
      <p className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Start from an example</p>
      <div className="grid grid-cols-1 gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.title}
            type="button"
            disabled={disabled}
            onClick={() => onPick(ex.prompt)}
            className={cn(
              "group flex items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-left transition-all",
              "hover:border-indigo-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60",
              "disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-500/50",
            )}
          >
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 transition-colors group-hover:bg-indigo-50 group-hover:text-indigo-600 dark:bg-zinc-800 dark:group-hover:bg-indigo-500/15 dark:group-hover:text-indigo-300">
              {ex.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{ex.title}</span>
                <span className="rounded bg-zinc-100 px-1 py-px text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">{ex.tag}</span>
              </span>
              <span className="mt-0.5 line-clamp-2 block text-xs text-zinc-500 dark:text-zinc-400">{ex.prompt}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Bubble({ item }: { item: Extract<ChatItem, { kind: "user" | "assistant" }> }) {
  if (item.kind === "user") {
    return (
      <div className="flex animate-slide-up justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2 text-[13px] leading-relaxed text-white shadow-sm">
          {item.text}
        </div>
      </div>
    );
  }
  const warning = item.tone === "warning";
  return (
    <div className={cn("flex animate-slide-up gap-2 px-1 text-xs leading-relaxed", warning ? "text-amber-700 dark:text-amber-400" : "text-zinc-500 dark:text-zinc-400")}>
      {warning ? <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> : <Info className="mt-0.5 size-3.5 shrink-0" />}
      <span className="min-w-0 whitespace-pre-wrap break-words">{item.text}</span>
    </div>
  );
}

interface ConversationPanelProps {
  items: ChatItem[];
  busy: AgentBusy;
  clarify: ClarifyState | null;
  models: CatalogModel[];
  hasDiagram: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onRetry: (run: RunRecord) => void;
  onSubmitClarify: (answers: ClarifyAnswers) => void;
  onSkipClarify: () => void;
}

const ConversationPanel = forwardRef<ComposerHandle, ConversationPanelProps>(function ConversationPanel(
  { items, busy, clarify, models, hasDiagram, disabled = false, onSend, onStop, onRetry, onSubmitClarify, onSkipClarify },
  composerRef,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastItem = items[items.length - 1];
  const lastRunSteps = lastItem?.kind === "run" ? lastItem.run.steps.length : 0;

  useEffect(() => {
    if (items.length === 0 && !clarify && busy === "idle") return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [items.length, lastRunSteps, clarify, busy]);

  const running = busy === "running";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-4">
        {items.length === 0 && !clarify && busy === "idle" ? (
          <EmptyState onPick={onSend} disabled={disabled} />
        ) : (
          items.map((item) =>
            item.kind === "run" ? (
              <RunCard key={item.id} run={item.run} models={models} onStop={onStop} onRetry={busy === "idle" ? onRetry : undefined} />
            ) : (
              <Bubble key={item.id} item={item} />
            ),
          )
        )}

        {busy === "clarifying" && (
          <div className="flex animate-fade-in items-center gap-2 px-1 text-xs text-zinc-500 dark:text-zinc-400">
            <Spinner className="size-3.5" />
            Reading your request and preparing questions…
          </div>
        )}

        {clarify && busy === "idle" && (
          <ClarifyPanel questions={clarify.questions} onSubmit={onSubmitClarify} onSkip={onSkipClarify} isSubmitting={false} />
        )}
      </div>

      <Composer
        ref={composerRef}
        onSend={onSend}
        onStop={onStop}
        running={running}
        disabled={disabled || busy === "clarifying"}
        placeholder={clarify ? "Or describe a different architecture…" : hasDiagram ? "Describe a change, e.g. “add a Redis cache”…" : "Describe an architecture…"}
        status={busy === "clarifying" ? "Analyzing request" : running ? "Working — press Esc to stop" : undefined}
      />
    </div>
  );
});

export default ConversationPanel;
