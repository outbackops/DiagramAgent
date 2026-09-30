# Sample prompts

Copy a prompt into the app and watch it build. To start the app, run `npm run dev` and open http://localhost:3000; see the [README](../README.md#quick-start).

## Choosing the style

Open **Generation settings** (the gear icon) and choose a **Diagram style**:

| Style | What you get | When it's used |
|---|---|---|
| **Auto** (default) | Architecture or Poster, chosen from your request | Words like *overview*, *journey*, *process*, *explain*, *roadmap* or *one-pager*, with no infrastructure terms, give a Poster; anything else gives an Architecture diagram. With clarifying questions on, the model makes this call. |
| **Architecture** | A reference-architecture diagram in the platform's conventions: nested boundaries, service icons, labelled connections, numbered workflows and assumptions | Always, whatever the wording |
| **Poster** | A designed one-page overview: columns, lanes and cards | Always |
| **Graph** | A free-form diagram laid out by D2 | Only when you pick it; Auto never does |

**Tips:**
- **Run card.** Each run shows the style it used ("Architecture · auto"), and **Redo as …** draws the same request in the other style.
- **Clarifying questions** (same menu) ask two or three questions before drawing. Turn them off to go straight to the diagram.
- **Invented values are labelled.** For a new design, values you didn't give (SKUs, address ranges, counts) are listed on the diagram as assumptions, or under *Proposed, not in the request* when the model didn't list them itself.

## Architecture

Pick **Architecture**, or leave the style on **Auto**: all of these route to Architecture.

### Google Cloud: multi-region web app

This is modelled on Google's [multi-regional reference architecture](https://cloud.google.com/architecture/multiregional-vms). Look for the two regions drawn as a mirrored grid: web, application and database tiers line up, with zones a, b and c inside each tier. Google Cloud services show initials tiles, because only the Google Cloud logo is vendored, not per-service icons.

```text
Multi-region web application on Google Cloud, like Google's multi-regional reference architecture. Application users reach a global external Application Load Balancer. Draw two regions side by side, Region AA and Region BB, each with the same three tiers drawn as boxes: a web tier (a regional managed instance group of three Compute Engine web servers in zones a, b and c), an application tier (a regional internal load balancer in front of a regional managed instance group of three app servers in zones a, b and c), and a database tier (a primary PostgreSQL on Compute Engine in zone b and a standby in zone c, with replication and failover). The primary databases replicate between the regions, and both regions use dual-region Cloud Storage buckets.
```

### AWS: three-tier web app across two Availability Zones

Look for the Availability Zones drawn as a grid, with public, app and data subnets lined up across them. There's one load balancer, and the Auto Scaling group is drawn as a group rather than a box.

```text
Create an AWS three-tier web application architecture diagram. Include internet users, Route 53, CloudFront, WAF, a public Application Load Balancer across two Availability Zones, EC2 Auto Scaling Group instances in private application subnets, RDS Multi-AZ in private data subnets, ElastiCache Redis, NAT Gateways, S3 static assets, Secrets Manager, CloudWatch, and VPC Flow Logs. Show HTTPS request flow from users through CloudFront and ALB to EC2, then SQL to RDS and cache calls to Redis. Group by AWS account, region, VPC, public/private subnets, and Availability Zones.
```

### Azure: zone-redundant web app

Look for these Azure conventions:
- App Service outside the VNet, with VNet integration
- private endpoints in their own subnet, each lined up with its service
- zones inside the App Service plan
- a numbered inbound flow and a lettered outbound flow

```text
Create an Azure reference architecture for a zone-redundant web application. Users reach the app over HTTPS through Azure Application Gateway with WAF in a spoke virtual network. App Service runs across three availability zones with VNet integration. Azure SQL Database, Key Vault and Storage are reached only through private endpoints in a dedicated subnet. Include Microsoft Entra ID, Application Insights and Log Analytics as shared services. Number the inbound request flow and the outbound data access flow.
```

### Azure: hub-and-spoke network

Look for a network view: the hub's gateway, firewall and Bastion subnets, spokes peered to the hub, and routes through the firewall.

```text
Create an Azure hub-spoke network architecture diagram. Include on-premises datacenter, VPN Gateway, ExpressRoute circuit, hub VNet, Azure Firewall, Azure Bastion, Private DNS Resolver, shared services subnet, management subnet, two spoke VNets for workload A and workload B, peering links, route tables/UDRs, NSGs, application subnets, data subnets, private endpoints, Log Analytics, and Azure Monitor. Show on-prem to hub connectivity, hub-to-spoke routing through the firewall, private endpoint access, and monitoring flows. Group by subscription, region, hub, spokes, and subnets.
```

### Azure: SQL Server Always On across two regions

Look for the primary and DR regions mirrored, with matching tiers lined up, and synchronous and asynchronous replication drawn as replication lines.

```text
Create a vendor-specific Azure architecture diagram for SQL Server Always On availability groups across two Azure regions. Show external users entering through Azure Traffic Manager and Azure Application Gateway in each region. Each region must have its own VNet, web subnet, application subnet, data subnet, SQL Server VM pair, Availability Group listener, domain controller, Azure Bastion, Network Security Groups, Azure Monitor, Log Analytics, and Backup Vault. Show synchronous replication inside the primary region, asynchronous replication to the DR region, health probes, failover path, and backup flow. Use clear Primary Region and DR Region boundaries with mirrored structure.
```

### Kubernetes: microservices with a service mesh

Look for Kubernetes conventions: the cluster and namespaces as boundaries, and ingress, east-west mTLS, async events and observability as distinct line styles.

```text
Create a vendor-neutral Kubernetes microservices architecture diagram. Show external users, DNS, ingress controller, API gateway, Kubernetes cluster, namespaces for frontend, backend services, data, and observability. Include service mesh sidecars, frontend service, orders service, payments service, inventory service, PostgreSQL, Redis, message broker, Prometheus, Grafana, Jaeger tracing, log collector, secrets, and horizontal pod autoscaler. Show north-south ingress traffic, east-west mTLS service-to-service traffic, async events to the broker, metrics/logs/traces to observability, and database/cache access.
```

### Multi-cloud disaster recovery

Look for each cloud's boundary drawn in its own conventions (AWS and Azure) on the same page.

```text
Multi-cloud web platform: the primary runs on AWS (CloudFront, an Application Load Balancer, ECS on Fargate, Aurora PostgreSQL) and disaster recovery runs on Azure (Front Door, Azure Container Apps, Azure Database for PostgreSQL). Route 53 fails traffic over between the clouds, and the database replicates nightly from Aurora to Azure. Show each cloud in its own conventions.
```

### An existing system (no invented facts)

Look for what's missing. Because this describes an existing system, the diagram leaves out the address ranges you didn't give, rather than making them up.

```text
Draw our existing hybrid setup. Our on-premises datacenter runs SQL Server and an Active Directory domain. It connects to Azure over ExpressRoute into a hub VNet with Azure Firewall. A spoke VNet runs AKS for the customer portal, which calls the on-premises SQL Server through the firewall. We don't know the address ranges.
```

### Streaming data platform

Look for a dataflow view: ingestion, processing, storage, serving and operations zones, with the event path labelled.

```text
Create a vendor-neutral streaming data pipeline diagram. Include producers, Kafka cluster with topics, schema registry, stream ingestion service, Apache Spark streaming jobs, checkpoint storage, raw data lake zone, curated data lake zone, batch quality checks, data warehouse, BI dashboard, metadata catalog, monitoring, and alerting. Show event ingestion, schema validation, stream processing, writes to raw and curated zones, warehouse loading, BI queries, and operational metrics. Group into ingestion, processing, storage, serving, and operations zones.
```

## Poster

Pick **Poster**, or leave the style on **Auto**: these are worded as overviews, journeys and processes, with no infrastructure terms, so Auto picks Poster.

### Customer onboarding journey

Look for lanes for the customer, the bank's systems and the operations team, lettered flows through them, and the timing on each card.

```text
Customer onboarding journey for a digital bank, from sign-up to first payment: sign up in the app, verify identity with a document scan and a selfie, manual review when a check fails, account opened, card issued, first deposit and first payment. Show the customer, the bank's systems and the operations team as lanes, with a typical time for each stage.
```

### How a knowledge assistant works

Look for a one-page explainer for a non-technical audience.

```text
An overview of how our knowledge assistant works, as a one-pager for leadership: documents are collected, split into passages and indexed; an employee asks a question; the assistant finds the most relevant passages and drafts an answer with citations; reviewers flag wrong answers so the index keeps improving.
```

### Incident response process

Look for the steps grouped by owner.

```text
Explain our incident response process on one page: detect (an alert or a customer report), triage and declare a severity, assemble responders, mitigate, post status updates, resolve, and run a blameless postmortem with follow-up actions. Show who owns each step: the on-call engineer, the incident commander and the communications lead.
```

## Graph

Pick **Graph**: Auto never chooses it. Graph suits free-form diagrams, where D2's automatic layout does well: state machines, dependency graphs, lineage.

### Order state machine

Look for states and transitions, with final states drawn double-bordered.

```text
State machine for an online order: created, paid, packed, shipped and delivered, with cancel allowed until the order is packed, returns after delivery, and a refund for cancelled or returned orders.
```

### Service dependency graph

```text
A dependency graph of our services: the web and mobile apps call an API gateway; the gateway calls auth, catalog, cart and checkout; checkout calls payments, inventory and notifications; payments calls a fraud-scoring service; every service sends logs to a central log pipeline.
```

## Try the same request in each style

1. Run the *knowledge assistant* prompt on **Auto**. You get a Poster.
2. Click **Redo as Architecture** on its run card to see the same request as a system diagram.
3. Switch the style to **Graph** and send the prompt again to compare D2's layout.

## Follow-up edits

After an Architecture diagram is drawn, type follow-ups in the chat, for example:

```text
Add Azure Front Door in front of the Application Gateway and make it step 1 of the inbound flow.
```

```text
Show the outbound data access as a second, lettered workflow.
```

```text
Move the Redis cache into the data subnet and label its connection "Redis 6379".
```

You can also edit on the canvas:
- Select a component to change its detail, its icon or a connection's meaning.
- Drag a component into another boundary.
- Click **Tidy up** to re-lay out the diagram and keep your edits.

## Reproduce the README images

The README's example images are rendered from spec files in the repo, so you can open the exact diagrams without a model call. There are two ways:
- **In the app:** in the inspector, go to **Code** → **Import...** and paste the contents of a spec file.
- **From the command line:**

  ```bash
  npm run compose -- src/test/fixtures/architecture/aws-multi-az-three-tier.json -o aws.png
  ```

| README image | Spec file |
|---|---|
| AWS three-tier across two Availability Zones | [`aws-multi-az-three-tier.json`](../src/test/fixtures/architecture/aws-multi-az-three-tier.json) |
| Azure hub-and-spoke network | [`azure-hub-spoke.json`](../src/test/fixtures/architecture/azure-hub-spoke.json) |
| Zone-redundant web app (the README's first image) | [`azure-zone-redundant-web.json`](../src/test/fixtures/architecture/azure-zone-redundant-web.json) |
| Kubernetes shop | [`kubernetes-shop.json`](../src/test/fixtures/architecture/kubernetes-shop.json) |
| Hybrid analytics across three clouds | [`multi-cloud-hybrid.json`](../src/test/fixtures/architecture/multi-cloud-hybrid.json) |
| Poster: knowledge assistant | [`knowledge-assistant.json`](../src/test/fixtures/compositions/knowledge-assistant.json) |
| Poster: hub-and-spoke network | [`hub-spoke-network.json`](../src/test/fixtures/compositions/hub-spoke-network.json) |

The eval harness uses more prompts, in [`evals/cases.json`](../evals/cases.json) and [`evals/held-out.json`](../evals/held-out.json).
