# NoMarkup Terraform (AWS skeleton)

Meaningful modules for the production foundation:

| Module | Purpose |
|--------|---------|
| `modules/vpc` | VPC, public/private subnets, IGW, optional NAT |
| `modules/eks` | EKS control plane + managed node group IAM |
| `modules/rds` | PostgreSQL 16 (multi-AZ, encrypted); enable PostGIS after boot |
| `modules/redis` | ElastiCache Redis 7 replication group (TLS + at-rest) |
| `modules/s3` | Encrypted assets bucket, public access blocked |

## Validate (no credentials required for syntax)

```bash
cd deploy/terraform
terraform init -backend=false
terraform validate
```

## Plan / apply

Requires AWS credentials in the environment (or instance profile). **Do not
commit credentials.** Uncomment the S3 backend in `versions.tf` when a state
bucket exists.

```bash
terraform plan -var='environment=staging'
# review, then:
# terraform apply -var='environment=staging'
```

After RDS is up, enable PostGIS and store `DATABASE_URL` / `REDIS_URL` /
S3 keys in Vault → `nomarkup-secrets` (see `deploy/k8s/SECRETS.md`).
