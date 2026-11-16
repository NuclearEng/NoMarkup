# NoMarkup Terraform — skeleton (not provisioned)

> **Status: Partial / Founder-Action.** This directory is an **in-repo skeleton** for
> the AWS foundation. Nothing here has been applied to a real account. There is
> **no AWS account ID**, no remote state bucket, and no committed credentials.
> Setting `DEPLOY_PROVISIONED=true` still requires a **real** cluster + secrets
> (`docs/operations/provisioning-checklist.md`).

Do **not** treat `terraform plan` as green production proof until a founder has
created the AWS account, state backend, and reviewed cost/security.

## Required resources (inventory)

| Need | Why | Skeleton path | Notes |
|------|-----|---------------|--------|
| **VPC** (public/private subnets, optional NAT) | Isolate EKS + data plane | `modules/vpc` | Draft; single-NAT cost model is intentional minimal |
| **Kubernetes cluster (EKS)** | Hosts gateway, services, engines, Meilisearch | `modules/eks` | Minimal control plane + one managed node group; add-ons/IRSA/ALB not included |
| **PostgreSQL 16 + PostGIS** | Primary app DB (geo) | `modules/rds` | RDS Postgres 16 resource only; **PostGIS is post-boot** (`CREATE EXTENSION postgis`) — not auto-enabled by this skeleton |
| **Redis 7** | Cache / sessions / pubsub | `modules/redis` | ElastiCache replication group draft (TLS + at-rest) |
| **S3** (assets / uploads) | Object storage (MinIO in dev) | `modules/s3` | Private bucket defaults (SSE, public access block) |
| **Remote state** (S3 + lock table) | Shared `terraform.tfstate` | commented block in `versions.tf` | **Not created** — uncomment only after real bucket/table exist |
| **Secrets / Vault → K8s** | `DATABASE_URL`, `REDIS_URL`, S3 keys, JWT, Stripe… | out of scope here | See `deploy/k8s/SECRETS.md` + `externalsecret.sample.yaml` |
| **Meilisearch** | Search | **not in Terraform** | Runs in-cluster today (`deploy/k8s/base/meilisearch/`); managed alternative is founder choice |

### Explicitly out of this skeleton

- AWS account / org / IAM SSO / billing alerts
- Cloudflare DNS/CDN for `no-markup.com` (registrar already; edge not wired by TF)
- mTLS mesh certs, OTel SaaS backend, Prometheus PVC
- Fake or placeholder **account IDs** (none are committed)

If infra is provisioned **outside** this repo (console, another IaC monorepo, managed
platform), document that path here and keep modules as reference only.

## Layout

```
deploy/terraform/
  README.md          # this file — honesty + inventory
  versions.tf        # required_providers; remote backend commented
  providers.tf       # aws provider (region from var; no account hardcode)
  variables.tf       # environment, sizes, AZs
  main.tf            # wires modules (draft)
  outputs.tf         # IDs/endpoints only (no secrets in cleartext outputs at root)
  modules/
    vpc/ eks/ rds/ redis/ s3/
```

## Validate syntax (optional)

Requires a local [Terraform](https://developer.hashicorp.com/terraform/install) ≥ 1.5
CLI. **Not** installed by this repo; **not** a CI gate today.

```bash
cd deploy/terraform
terraform init -backend=false
terraform validate
```

## Plan / apply (founder only)

Requires real AWS credentials in the environment (or instance profile). **Never
commit credentials or account IDs.**

```bash
# 1. Create remote state bucket + DynamoDB lock table out-of-band, then
#    uncomment backend "s3" in versions.tf with *your* names.
# 2. Review variables (region, instance sizes, NAT cost).
# 3. Plan against a real account you own:
terraform plan -var='environment=staging'
# 4. Apply only after cost + security review:
# terraform apply -var='environment=staging'
```

After RDS is up: enable PostGIS, then store `DATABASE_URL` / `REDIS_URL` / S3
credentials in Vault → `nomarkup-secrets` (see `deploy/k8s/SECRETS.md`).

## Relation to deploy gate

| Artifact | Role |
|----------|------|
| This skeleton | Documents + drafts cloud resources |
| `deploy/k8s/` | Workload manifests (apply after cluster exists) |
| `.github/workflows/deploy.yml` | Fail-closed until `DEPLOY_PROVISIONED=true` + kube/registry secrets |
| OPS-02 (tracker) | **Partial** — skeleton present; live provision remains Founder-Action |
