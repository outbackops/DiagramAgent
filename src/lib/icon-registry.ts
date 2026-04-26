// Icon registry mapping short icon keys to SVG URLs from verified icon sources
// AWS + Tech: Iconify logos CDN (verified working)
// Azure: benc-uk/icon-collection on GitHub (291 official Azure icons)
// GCP: Iconify + generic fallbacks
// K8s: Iconify logos + generic fallbacks

const ICONIFY = "https://api.iconify.design/logos";
const ICONIFY_MDI = "https://api.iconify.design/mdi";
const AZURE_ICONS = "https://raw.githubusercontent.com/benc-uk/icon-collection/master/azure-icons";

export interface IconEntry {
  url: string;
  label: string;
  category: "aws" | "azure" | "gcp" | "kubernetes" | "tech" | "general";
}

export const iconRegistry: Record<string, IconEntry> = {
  // ==================== AWS Icons (Iconify logos - verified) ====================
  "aws": { url: `${ICONIFY}/aws.svg`, label: "AWS", category: "aws" },
  "aws-ec2": { url: `${ICONIFY}/aws-ec2.svg`, label: "EC2", category: "aws" },
  "aws-s3": { url: `${ICONIFY}/aws-s3.svg`, label: "S3", category: "aws" },
  "aws-rds": { url: `${ICONIFY}/aws-rds.svg`, label: "RDS", category: "aws" },
  "aws-lambda": { url: `${ICONIFY}/aws-lambda.svg`, label: "Lambda", category: "aws" },
  "aws-dynamodb": { url: `${ICONIFY}/aws-dynamodb.svg`, label: "DynamoDB", category: "aws" },
  "aws-ecs": { url: `${ICONIFY}/aws-ecs.svg`, label: "ECS", category: "aws" },
  "aws-eks": { url: `${ICONIFY}/aws-eks.svg`, label: "EKS", category: "aws" },
  "aws-api-gateway": { url: `${ICONIFY}/aws-api-gateway.svg`, label: "API Gateway", category: "aws" },
  "aws-cloudfront": { url: `${ICONIFY}/aws-cloudfront.svg`, label: "CloudFront", category: "aws" },
  "aws-route53": { url: `${ICONIFY}/aws-route53.svg`, label: "Route 53", category: "aws" },
  "aws-vpc": { url: `${ICONIFY}/aws-vpc.svg`, label: "VPC", category: "aws" },
  "aws-sqs": { url: `${ICONIFY}/aws-sqs.svg`, label: "SQS", category: "aws" },
  "aws-sns": { url: `${ICONIFY}/aws-sns.svg`, label: "SNS", category: "aws" },
  "aws-kinesis": { url: `${ICONIFY}/aws-kinesis.svg`, label: "Kinesis", category: "aws" },
  "aws-redshift": { url: `${ICONIFY}/aws-redshift.svg`, label: "Redshift", category: "aws" },
  "aws-elasticache": { url: `${ICONIFY}/aws-elasticache.svg`, label: "ElastiCache", category: "aws" },
  "aws-cloudwatch": { url: `${ICONIFY}/aws-cloudwatch.svg`, label: "CloudWatch", category: "aws" },
  "aws-iam": { url: `${ICONIFY}/aws-iam.svg`, label: "IAM", category: "aws" },
  "aws-cognito": { url: `${ICONIFY}/aws-cognito.svg`, label: "Cognito", category: "aws" },
  "aws-secrets-manager": { url: `${ICONIFY}/aws-secrets-manager.svg`, label: "Secrets Manager", category: "aws" },
  "aws-step-functions": { url: `${ICONIFY}/aws-step-functions.svg`, label: "Step Functions", category: "aws" },
  "aws-eventbridge": { url: `${ICONIFY}/aws-eventbridge.svg`, label: "EventBridge", category: "aws" },
  "aws-fargate": { url: `${ICONIFY}/aws-fargate.svg`, label: "Fargate", category: "aws" },
  "aws-elastic-load-balancing": { url: `${ICONIFY}/aws-elb.svg`, label: "ELB", category: "aws" },
  "aws-elb": { url: `${ICONIFY}/aws-elb.svg`, label: "ELB", category: "aws" },
  "aws-codepipeline": { url: `${ICONIFY}/aws-codepipeline.svg`, label: "CodePipeline", category: "aws" },
  "aws-codebuild": { url: `${ICONIFY}/aws-codebuild.svg`, label: "CodeBuild", category: "aws" },
  "aws-cloudformation": { url: `${ICONIFY}/aws-cloudformation.svg`, label: "CloudFormation", category: "aws" },
  "aws-athena": { url: `${ICONIFY}/aws-athena.svg`, label: "Athena", category: "aws" },
  "aws-glue": { url: `${ICONIFY}/aws-glue.svg`, label: "Glue", category: "aws" },
  "aws-aurora": { url: `${ICONIFY}/aws-aurora.svg`, label: "Aurora", category: "aws" },
  "aws-elastic-beanstalk": { url: `${ICONIFY}/aws-elastic-beanstalk.svg`, label: "Elastic Beanstalk", category: "aws" },
  "aws-waf": { url: `${ICONIFY}/aws-waf.svg`, label: "WAF", category: "aws" },
  "aws-shield": { url: `${ICONIFY}/aws-shield.svg`, label: "Shield", category: "aws" },
  "aws-ses": { url: `${ICONIFY}/aws-ses.svg`, label: "SES", category: "aws" },
  "aws-msk": { url: `${ICONIFY}/aws-msk.svg`, label: "MSK", category: "aws" },
  "aws-documentdb": { url: `${ICONIFY}/aws-documentdb.svg`, label: "DocumentDB", category: "aws" },
  "aws-batch": { url: `${ICONIFY}/aws-batch.svg`, label: "Batch", category: "aws" },
  "aws-xray": { url: `${ICONIFY}/aws-xray.svg`, label: "X-Ray", category: "aws" },
  "aws-config": { url: `${ICONIFY}/aws-config.svg`, label: "Config", category: "aws" },
  "aws-cloudtrail": { url: `${ICONIFY}/aws-cloudtrail.svg`, label: "CloudTrail", category: "aws" },
  "aws-kms": { url: `${ICONIFY}/aws-kms.svg`, label: "KMS", category: "aws" },

  // ==================== Azure Icons (benc-uk GitHub - verified) ====================
  "azure": { url: `${ICONIFY}/microsoft-azure.svg`, label: "Azure", category: "azure" },
  "azure-virtual-machine": { url: `${AZURE_ICONS}/Virtual-Machine.svg`, label: "Virtual Machine", category: "azure" },
  "azure-app-service": { url: `${AZURE_ICONS}/App-Services.svg`, label: "App Service", category: "azure" },
  "azure-functions": { url: `${AZURE_ICONS}/Function-Apps.svg`, label: "Functions", category: "azure" },
  "azure-sql-database": { url: `${AZURE_ICONS}/SQL-Database.svg`, label: "SQL Database", category: "azure" },
  "azure-sql-server": { url: `${AZURE_ICONS}/SQL-Server.svg`, label: "SQL Server", category: "azure" },
  "azure-sql-managed-instance": { url: `${AZURE_ICONS}/SQL-Managed-Instance.svg`, label: "SQL Managed Instance", category: "azure" },
  "azure-cosmos-db": { url: `${AZURE_ICONS}/Azure-Cosmos-DB.svg`, label: "Cosmos DB", category: "azure" },
  "azure-storage": { url: `${AZURE_ICONS}/Storage-Accounts.svg`, label: "Storage", category: "azure" },
  "azure-blob-storage": { url: `${AZURE_ICONS}/Blob-Block.svg`, label: "Blob Storage", category: "azure" },
  "azure-kubernetes-service": { url: `${AZURE_ICONS}/Kubernetes-Services.svg`, label: "AKS", category: "azure" },
  "azure-container-instances": { url: `${AZURE_ICONS}/Container-Instances.svg`, label: "Container Instances", category: "azure" },
  "azure-container-registry": { url: `${AZURE_ICONS}/Container-Registries.svg`, label: "Container Registry", category: "azure" },
  "azure-virtual-networks": { url: `${AZURE_ICONS}/Virtual-Networks.svg`, label: "Virtual Network", category: "azure" },
  "azure-load-balancers": { url: `${AZURE_ICONS}/Load-Balancers.svg`, label: "Load Balancer", category: "azure" },
  "azure-application-gateway": { url: `${AZURE_ICONS}/Application-Gateways.svg`, label: "Application Gateway", category: "azure" },
  "azure-front-door": { url: `${AZURE_ICONS}/Front-Doors.svg`, label: "Front Door", category: "azure" },
  "azure-dns": { url: `${AZURE_ICONS}/DNS-Zones.svg`, label: "DNS", category: "azure" },
  "azure-cdn": { url: `${AZURE_ICONS}/CDN-Profiles.svg`, label: "CDN", category: "azure" },
  "azure-active-directory": { url: `${AZURE_ICONS}/Azure-Active-Directory.svg`, label: "Active Directory", category: "azure" },
  "azure-key-vault": { url: `${AZURE_ICONS}/Key-Vaults.svg`, label: "Key Vault", category: "azure" },
  "azure-monitor": { url: `${AZURE_ICONS}/Monitor.svg`, label: "Monitor", category: "azure" },
  "azure-log-analytics": { url: `${AZURE_ICONS}/Log-Analytics-Workspaces.svg`, label: "Log Analytics", category: "azure" },
  "azure-devops": { url: `${AZURE_ICONS}/Azure-DevOps.svg`, label: "DevOps", category: "azure" },
  "azure-service-bus": { url: `${AZURE_ICONS}/Service-Bus.svg`, label: "Service Bus", category: "azure" },
  "azure-event-hubs": { url: `${AZURE_ICONS}/Event-Hubs.svg`, label: "Event Hubs", category: "azure" },
  "azure-event-grid": { url: `${AZURE_ICONS}/Event-Grid-Topics.svg`, label: "Event Grid", category: "azure" },
  "azure-logic-apps": { url: `${AZURE_ICONS}/Logic-Apps.svg`, label: "Logic Apps", category: "azure" },
  "azure-api-management": { url: `${AZURE_ICONS}/API-Management-Services.svg`, label: "API Management", category: "azure" },
  "azure-cache-redis": { url: `${AZURE_ICONS}/Cache-Redis.svg`, label: "Azure Cache for Redis", category: "azure" },
  "azure-cognitive-services": { url: `${AZURE_ICONS}/Cognitive-Services.svg`, label: "Cognitive Services", category: "azure" },
  "azure-data-factory": { url: `${AZURE_ICONS}/Data-Factory.svg`, label: "Data Factory", category: "azure" },
  "azure-synapse-analytics": { url: `${AZURE_ICONS}/Azure-Synapse-Analytics.svg`, label: "Synapse Analytics", category: "azure" },
  "azure-firewall": { url: `${AZURE_ICONS}/Firewalls.svg`, label: "Firewall", category: "azure" },
  "azure-network-security-groups": { url: `${AZURE_ICONS}/Network-Security-Groups.svg`, label: "NSG", category: "azure" },
  "azure-vpn-gateway": { url: `${AZURE_ICONS}/Virtual-Network-Gateways.svg`, label: "VPN Gateway", category: "azure" },
  "azure-expressroute": { url: `${AZURE_ICONS}/ExpressRoute-Circuits.svg`, label: "ExpressRoute", category: "azure" },
  "azure-bastion": { url: `${ICONIFY_MDI}/shield-key.svg?color=%230078D4`, label: "Bastion", category: "azure" },
  "azure-traffic-manager": { url: `${AZURE_ICONS}/Traffic-Manager-Profiles.svg`, label: "Traffic Manager", category: "azure" },
  "azure-availability-set": { url: `${AZURE_ICONS}/Availability-Sets.svg`, label: "Availability Set", category: "azure" },
  "azure-vm-scale-sets": { url: `${AZURE_ICONS}/VM-Scale-Sets.svg`, label: "VM Scale Sets", category: "azure" },
  "azure-disk": { url: `${AZURE_ICONS}/Disks.svg`, label: "Managed Disk", category: "azure" },
  "azure-public-ip": { url: `${AZURE_ICONS}/Public-IP-Addresses.svg`, label: "Public IP", category: "azure" },
  "azure-app-insights": { url: `${AZURE_ICONS}/Application-Insights.svg`, label: "Application Insights", category: "azure" },
  "azure-service-fabric": { url: `${AZURE_ICONS}/Service-Fabric-Clusters.svg`, label: "Service Fabric", category: "azure" },
  "azure-bot-service": { url: `${AZURE_ICONS}/Bot-Services.svg`, label: "Bot Service", category: "azure" },
  "azure-iot-hub": { url: `${AZURE_ICONS}/IoT-Hub.svg`, label: "IoT Hub", category: "azure" },
  "azure-recovery-vault": { url: `${AZURE_ICONS}/Recovery-Services-Vaults.svg`, label: "Recovery Vault", category: "azure" },
  "azure-ddos": { url: `${AZURE_ICONS}/DDoS-Protection-Plans.svg`, label: "DDoS Protection", category: "azure" },
  "azure-waf": { url: `${AZURE_ICONS}/Web-Application-Firewall-Policies(WAF).svg`, label: "WAF", category: "azure" },
  "azure-private-link": { url: `${AZURE_ICONS}/Private-Link.svg`, label: "Private Link", category: "azure" },
  "azure-databricks": { url: `https://api.iconify.design/simple-icons/databricks.svg`, label: "Databricks", category: "azure" },
  "azure-static-apps": { url: `${AZURE_ICONS}/Static-Apps.svg`, label: "Static Web Apps", category: "azure" },
  "azure-hdinsight": { url: `${AZURE_ICONS}/HD-Insight-Clusters.svg`, label: "HDInsight", category: "azure" },
  "azure-batch": { url: `${AZURE_ICONS}/Batch-Accounts.svg`, label: "Batch", category: "azure" },
  "azure-search": { url: `${AZURE_ICONS}/Search-Services.svg`, label: "Cognitive Search", category: "azure" },
  "azure-notification-hub": { url: `${AZURE_ICONS}/Notification-Hubs.svg`, label: "Notification Hub", category: "azure" },
  "azure-digital-twins": { url: `${AZURE_ICONS}/Digital-Twins.svg`, label: "Digital Twins", category: "azure" },
  "azure-policy": { url: `${AZURE_ICONS}/Policy.svg`, label: "Policy", category: "azure" },
  "azure-sentinel": { url: `${AZURE_ICONS}/Azure-Sentinel.svg`, label: "Sentinel", category: "azure" },
  "azure-security-center": { url: `${AZURE_ICONS}/Security-Center.svg`, label: "Security Center", category: "azure" },

  // ==================== GCP Icons ====================
  "gcp": { url: `${ICONIFY}/google-cloud.svg`, label: "Google Cloud", category: "gcp" },
  "gcp-compute-engine": { url: `${ICONIFY}/google-cloud.svg`, label: "Compute Engine", category: "gcp" },
  "gcp-cloud-run": { url: `${ICONIFY}/google-cloud-run.svg`, label: "Cloud Run", category: "gcp" },
  "gcp-cloud-functions": { url: `${ICONIFY}/google-cloud-functions.svg`, label: "Cloud Functions", category: "gcp" },
  "gcp-gke": { url: `${ICONIFY}/kubernetes.svg`, label: "GKE", category: "gcp" },
  "gcp-cloud-storage": { url: `${ICONIFY}/google-cloud.svg`, label: "Cloud Storage", category: "gcp" },
  "gcp-cloud-sql": { url: `${ICONIFY}/google-cloud.svg`, label: "Cloud SQL", category: "gcp" },
  "gcp-bigquery": { url: `${ICONIFY}/google-cloud.svg`, label: "BigQuery", category: "gcp" },
  "gcp-pubsub": { url: `${ICONIFY}/google-cloud.svg`, label: "Pub/Sub", category: "gcp" },
  "gcp-dataflow": { url: `${ICONIFY}/google-cloud.svg`, label: "Dataflow", category: "gcp" },
  "gcp-cloud-logging": { url: `${ICONIFY}/google-cloud.svg`, label: "Cloud Logging", category: "gcp" },
  "gcp-load-balancing": { url: `${ICONIFY}/google-cloud.svg`, label: "Load Balancing", category: "gcp" },
  "gcp-vpc": { url: `${ICONIFY}/google-cloud.svg`, label: "VPC", category: "gcp" },
  "gcp-iam": { url: `${ICONIFY}/google-cloud.svg`, label: "IAM", category: "gcp" },
  "gcp-cloud-build": { url: `${ICONIFY}/google-cloud.svg`, label: "Cloud Build", category: "gcp" },
  "gcp-app-engine": { url: `${ICONIFY}/google-cloud.svg`, label: "App Engine", category: "gcp" },
  "gcp-firestore": { url: `${ICONIFY}/google-cloud.svg`, label: "Firestore", category: "gcp" },
  "gcp-spanner": { url: `${ICONIFY}/google-cloud.svg`, label: "Spanner", category: "gcp" },
  "gcp-memorystore": { url: `${ICONIFY}/google-cloud.svg`, label: "Memorystore", category: "gcp" },
  "gcp-cloud-armor": { url: `${ICONIFY}/google-cloud.svg`, label: "Cloud Armor", category: "gcp" },

  // ==================== Kubernetes Icons ====================
  "k8s": { url: `${ICONIFY}/kubernetes.svg`, label: "Kubernetes", category: "kubernetes" },
  "k8s-pod": { url: `${ICONIFY}/kubernetes.svg`, label: "Pod", category: "kubernetes" },
  "k8s-service": { url: `${ICONIFY}/kubernetes.svg`, label: "Service", category: "kubernetes" },
  "k8s-deployment": { url: `${ICONIFY}/kubernetes.svg`, label: "Deployment", category: "kubernetes" },
  "k8s-ingress": { url: `${ICONIFY}/kubernetes.svg`, label: "Ingress", category: "kubernetes" },
  "k8s-configmap": { url: `${ICONIFY}/kubernetes.svg`, label: "ConfigMap", category: "kubernetes" },
  "k8s-secret": { url: `${ICONIFY}/kubernetes.svg`, label: "Secret", category: "kubernetes" },
  "k8s-node": { url: `${ICONIFY}/kubernetes.svg`, label: "Node", category: "kubernetes" },
  "k8s-namespace": { url: `${ICONIFY}/kubernetes.svg`, label: "Namespace", category: "kubernetes" },
  "k8s-statefulset": { url: `${ICONIFY}/kubernetes.svg`, label: "StatefulSet", category: "kubernetes" },
  "k8s-daemonset": { url: `${ICONIFY}/kubernetes.svg`, label: "DaemonSet", category: "kubernetes" },
  "k8s-hpa": { url: `${ICONIFY}/kubernetes.svg`, label: "HPA", category: "kubernetes" },
  "k8s-pv": { url: `${ICONIFY}/kubernetes.svg`, label: "PersistentVolume", category: "kubernetes" },
  "k8s-cronjob": { url: `${ICONIFY}/kubernetes.svg`, label: "CronJob", category: "kubernetes" },

  // ==================== General Tech Icons (Iconify logos - verified) ====================
  "docker": { url: `${ICONIFY}/docker-icon.svg`, label: "Docker", category: "tech" },
  "terraform": { url: `${ICONIFY}/terraform-icon.svg`, label: "Terraform", category: "tech" },
  "ansible": { url: `${ICONIFY}/ansible.svg`, label: "Ansible", category: "tech" },
  "jenkins": { url: `${ICONIFY}/jenkins.svg`, label: "Jenkins", category: "tech" },
  "github": { url: `${ICONIFY}/github-icon.svg`, label: "GitHub", category: "tech" },
  "gitlab": { url: `${ICONIFY}/gitlab.svg`, label: "GitLab", category: "tech" },
  "nginx": { url: `${ICONIFY}/nginx.svg`, label: "Nginx", category: "tech" },
  "redis": { url: `${ICONIFY}/redis.svg`, label: "Redis", category: "tech" },
  "postgresql": { url: `${ICONIFY}/postgresql.svg`, label: "PostgreSQL", category: "tech" },
  "mysql": { url: `${ICONIFY}/mysql.svg`, label: "MySQL", category: "tech" },
  "mongodb": { url: `${ICONIFY}/mongodb-icon.svg`, label: "MongoDB", category: "tech" },
  "elasticsearch": { url: `${ICONIFY}/elasticsearch.svg`, label: "Elasticsearch", category: "tech" },
  "kafka": { url: `${ICONIFY}/kafka-icon.svg`, label: "Kafka", category: "tech" },
  "rabbitmq": { url: `${ICONIFY}/rabbitmq-icon.svg`, label: "RabbitMQ", category: "tech" },
  "graphql": { url: `${ICONIFY}/graphql.svg`, label: "GraphQL", category: "tech" },
  "nodejs": { url: `${ICONIFY}/nodejs-icon.svg`, label: "Node.js", category: "tech" },
  "python": { url: `${ICONIFY}/python.svg`, label: "Python", category: "tech" },
  "go": { url: `${ICONIFY}/go.svg`, label: "Go", category: "tech" },
  "java": { url: `${ICONIFY}/java.svg`, label: "Java", category: "tech" },
  "dotnet": { url: `${ICONIFY}/dotnet.svg`, label: ".NET", category: "tech" },
  "prometheus": { url: `${ICONIFY}/prometheus.svg`, label: "Prometheus", category: "tech" },
  "grafana": { url: `${ICONIFY}/grafana.svg`, label: "Grafana", category: "tech" },
  "vault": { url: `${ICONIFY}/vault-icon.svg`, label: "Vault", category: "tech" },
  "consul": { url: `${ICONIFY}/consul.svg`, label: "Consul", category: "tech" },
  "istio": { url: `https://api.iconify.design/simple-icons/istio.svg`, label: "Istio", category: "tech" },
  "envoy": { url: `${ICONIFY}/envoy.svg`, label: "Envoy", category: "tech" },
  "helm": { url: `${ICONIFY}/helm.svg`, label: "Helm", category: "tech" },
  "argocd": { url: `${ICONIFY}/argo-icon.svg`, label: "Argo CD", category: "tech" },
  "snowflake": { url: `${ICONIFY}/snowflake-icon.svg`, label: "Snowflake", category: "tech" },
  "databricks": { url: `https://api.iconify.design/simple-icons/databricks.svg`, label: "Databricks", category: "tech" },
  "spark": { url: `${ICONIFY}/apache-spark.svg`, label: "Spark", category: "tech" },
  "airflow": { url: `${ICONIFY}/airflow-icon.svg`, label: "Airflow", category: "tech" },
  "tensorflow": { url: `${ICONIFY}/tensorflow.svg`, label: "TensorFlow", category: "tech" },

  // ==================== General/Abstract Icons (Iconify MDI - verified) ====================
  "user": { url: `${ICONIFY_MDI}/account.svg?color=%23666`, label: "User", category: "general" },
  "users": { url: `${ICONIFY_MDI}/account-group.svg?color=%23666`, label: "Users", category: "general" },
  "server": { url: `${ICONIFY_MDI}/server.svg?color=%23666`, label: "Server", category: "general" },
  "database": { url: `${ICONIFY_MDI}/database.svg?color=%23666`, label: "Database", category: "general" },
  "cloud": { url: `${ICONIFY_MDI}/cloud.svg?color=%23666`, label: "Cloud", category: "general" },
  "internet": { url: `${ICONIFY_MDI}/web.svg?color=%23666`, label: "Internet", category: "general" },
  "firewall": { url: `${ICONIFY_MDI}/shield-lock.svg?color=%23666`, label: "Firewall", category: "general" },
  "lock": { url: `${ICONIFY_MDI}/lock.svg?color=%23666`, label: "Lock", category: "general" },
  "monitor": { url: `${ICONIFY_MDI}/monitor-dashboard.svg?color=%23666`, label: "Monitor", category: "general" },
  "api": { url: `${ICONIFY_MDI}/api.svg?color=%23666`, label: "API", category: "general" },
  "settings": { url: `${ICONIFY_MDI}/cog.svg?color=%23666`, label: "Settings", category: "general" },
  "email": { url: `${ICONIFY_MDI}/email.svg?color=%23666`, label: "Email", category: "general" },
  "notification": { url: `${ICONIFY_MDI}/bell.svg?color=%23666`, label: "Notification", category: "general" },
  "mobile": { url: `${ICONIFY_MDI}/cellphone.svg?color=%23666`, label: "Mobile", category: "general" },
  "desktop": { url: `${ICONIFY_MDI}/desktop-mac.svg?color=%23666`, label: "Desktop", category: "general" },
  "load-balancer": { url: `${ICONIFY_MDI}/scale-balance.svg?color=%23666`, label: "Load Balancer", category: "general" },
  "queue": { url: `${ICONIFY_MDI}/tray-full.svg?color=%23666`, label: "Queue", category: "general" },
  "storage": { url: `${ICONIFY_MDI}/harddisk.svg?color=%23666`, label: "Storage", category: "general" },
  "cache": { url: `${ICONIFY_MDI}/cached.svg?color=%23666`, label: "Cache", category: "general" },
  "container": { url: `${ICONIFY_MDI}/package-variant-closed.svg?color=%23666`, label: "Container", category: "general" },
};

// Resolve an icon key to a URL.
// Prefers vendored local copy under /icons/ when the build has run
// `npm run vendor:icons` (manifest at public/icons/manifest.json).
// Falls back to the upstream CDN URL when the icon is not vendored,
// which keeps the registry usable in dev without a vendor pass.
export function resolveIconUrl(key: string): string | undefined {
  if (vendoredIconKeys.has(key)) {
    return `/icons/${key}.svg`;
  }
  return iconRegistry[key]?.url;
}

/**
 * Set of icon keys present in public/icons/manifest.json. Loaded once at
 * module init in Node; on the client this is statically inlined as an
 * empty set (the renderer is server-side, so this branch is never reached
 * in a browser).
 */
let vendoredIconKeys: Set<string> = new Set();

if (typeof process !== "undefined" && process.versions?.node) {
  // Server-side only — load manifest from disk synchronously at module init.
  // ESM dynamic-importing fs synchronously isn't possible; require is fine
  // here because Next.js bundles this file for the Node runtime.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path");
    const manifestPath = path.join(process.cwd(), "public", "icons", "manifest.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
      vendoredIconKeys = new Set(Object.keys(manifest));
    }
  } catch {
    // best-effort: missing manifest just means we fall through to CDN URLs
  }
}

// Get all available icon keys
export function getIconKeys(): string[] {
  return Object.keys(iconRegistry);
}

// Get icons by category
export function getIconsByCategory(category: IconEntry["category"]): Record<string, IconEntry> {
  return Object.fromEntries(
    Object.entries(iconRegistry).filter(([, v]) => v.category === category)
  );
}

// Process D2 code: replace `icon: <key>` with `icon: <url>`
// Handles both dot notation (Node.icon: key) and block notation (icon: key)
// Skips values that are already URLs
export function resolveIconsInD2Code(d2Code: string): string {
  return d2Code.replace(
    /icon:\s*([a-zA-Z0-9_-]+)\s*$/gm,
    (match, key) => {
      // Skip if this looks like it's already a URL
      if (key.startsWith("http")) return match;
      const url = resolveIconUrl(key);
      return url ? `icon: ${url}` : match;
    }
  );
}

// Generate a summary of available icon keys for LLM system prompt
export function getIconKeySummary(): string {
  const categories = ["aws", "azure", "gcp", "kubernetes", "tech", "general"] as const;
  const lines: string[] = [];

  for (const cat of categories) {
    const icons = getIconsByCategory(cat);
    const keys = Object.keys(icons);
    lines.push(`${cat.toUpperCase()}: ${keys.join(", ")}`);
  }

  return lines.join("\n");
}
