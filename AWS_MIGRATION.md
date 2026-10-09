# AWS Cloud Migration Guide

This guide explains how to migrate this project from local Docker Compose to AWS with managed services:
- S3 for media storage
- ElastiCache for Redis (RQ queue)
- RDS for PostgreSQL
- EKS (Kubernetes) for API, worker, and frontend

## 1. Current Architecture Baseline

Current local stack:
- Next.js frontend
- FastAPI API
- RQ worker
- Redis
- PostgreSQL
- Local filesystem media storage at /data/media

Target AWS architecture:
- EKS Deployments: frontend, api, worker
- AWS ALB Ingress for external routing
- RDS PostgreSQL
- ElastiCache Redis
- S3 buckets for uploads and outputs
- ECR for container images
- IAM Roles for Service Accounts (IRSA) for S3 access

## 2. Prerequisites

- AWS account with admin bootstrap access
- AWS CLI v2 configured
- kubectl installed
- eksctl installed (or Terraform if preferred)
- helm installed
- Docker installed
- A Route53 hosted zone (optional but recommended)
- ACM certificate in region for HTTPS

## 3. High-Level Migration Sequence

1. Create AWS networking and cluster foundations (VPC, EKS).
2. Create RDS and ElastiCache.
3. Create S3 buckets and IAM permissions.
4. Build and push images to ECR.
5. Add S3 storage adapter in backend and config-driven selection.
6. Deploy Kubernetes resources.
7. Run DB migrations in cluster.
8. Validate end-to-end behavior.
9. Perform controlled cutover.

## 4. Provision AWS Core Infrastructure

### 4.1 VPC and EKS

Create an EKS cluster in private subnets with node groups.

Example with eksctl:

```bash
eksctl create cluster \
  --name media-tool \
  --region us-east-1 \
  --version 1.30 \
  --nodes 3 \
  --node-type t3.large \
  --managed
```

Best practices:
- Keep worker and api pods in private subnets.
- Use public subnets only for ALB.
- Enable cluster autoscaler.

### 4.2 ECR Repositories

Create repos:
- media-tool-api
- media-tool-worker
- media-tool-frontend

Build and push images tagged by commit SHA.

### 4.3 RDS PostgreSQL

Create PostgreSQL instance (or Aurora PostgreSQL).

Minimum recommendations:
- Multi-AZ for production
- Automatic backups enabled
- KMS encryption enabled
- Security group allows only EKS node/pod network

Connection string format:

```text
postgresql+psycopg2://<user>:<password>@<rds-endpoint>:5432/media_tool
```

### 4.4 ElastiCache Redis

Create Redis replication group.

Recommendations:
- At least 1 primary + 1 replica for production
- In-transit encryption enabled
- AUTH token enabled
- Restrict ingress to EKS only

Connection string format:

```text
redis://:<auth-token>@<redis-endpoint>:6379/0
```

### 4.5 S3 Buckets

Create buckets:
- media-tool-uploads-<env>
- media-tool-outputs-<env>

Bucket settings:
- Block all public access
- SSE-KMS encryption
- Lifecycle policies (expire old uploads, transition outputs if needed)
- Versioning enabled (recommended)

## 5. Backend Changes Needed for S3

The current storage implementation is local filesystem. Add a new S3 storage adapter and select via env config.

Suggested config additions:
- STORAGE_BACKEND=local|s3
- S3_REGION
- S3_UPLOADS_BUCKET
- S3_OUTPUTS_BUCKET
- S3_PUBLIC_BASE_URL (optional if using CloudFront)

Implementation details:
1. Keep existing storage interface methods:
   - save_upload(key, content)
   - read_bytes(key)
   - write_bytes(key, content)
   - public_url(key)
2. Add S3-backed implementation using boto3.
3. For worker FFmpeg processing:
   - download input object to temp file
   - process with ffmpeg/pillow
   - upload result object to S3
4. Stop using shared local media volume in cloud.

## 6. Kubernetes Design

### 6.1 Namespaces

Use separate namespaces per environment:
- media-tool-dev
- media-tool-staging
- media-tool-prod

### 6.2 Workloads

Deployments:
- frontend Deployment + Service
- api Deployment + Service
- worker Deployment (no Service needed)

Suggested scaling:
- api: HPA based on CPU and request rate
- worker: HPA or KEDA based on Redis queue depth

### 6.3 Ingress

Use AWS Load Balancer Controller (ALB Ingress).

Routing example:
- / -> frontend service
- /api/* -> api service (or frontend proxy pattern if retained)

Enable HTTPS with ACM cert and redirect HTTP->HTTPS.

### 6.4 Config and Secrets

Use:
- ConfigMap for non-sensitive config
- Secrets for DATABASE_URL, REDIS_URL, JWT_SECRET
- Prefer AWS Secrets Manager + External Secrets Operator in production

### 6.5 IAM and S3 Access

Use IRSA:
1. Create IAM policy allowing bucket read/write for uploads/outputs.
2. Create IAM role with that policy.
3. Annotate api/worker service accounts with IAM role ARN.

Do not use static AWS keys in env vars for production.

## 7. Example Kubernetes Manifests (Structure)

Recommended folders:

```text
infra/k8s/
  base/
    namespace.yaml
    api-deployment.yaml
    api-service.yaml
    worker-deployment.yaml
    frontend-deployment.yaml
    frontend-service.yaml
    ingress.yaml
    configmap.yaml
    secrets.yaml
  overlays/
    dev/
    staging/
    prod/
```

Use Kustomize or Helm to manage environment-specific values.

## 8. Database Migration in AWS

After api is deployed and can reach RDS:

```bash
kubectl -n media-tool-prod exec deploy/api -- alembic upgrade head
```

Alternative:
- Create a one-time Kubernetes Job that runs migrations during release.

## 9. CI/CD Pipeline Outline

Use GitHub Actions (or equivalent):

1. Run tests/lint.
2. Build images for api/worker/frontend.
3. Push to ECR with immutable tag (commit SHA).
4. Deploy manifests/helm chart to EKS.
5. Run migration job.
6. Run smoke tests against deployed endpoint.

Add rollback strategy:
- Keep previous image tags
- helm rollback or redeploy previous manifest version

## 10. Cutover Plan

### 10.1 Staging Validation

Validate:
- Upload flow works
- Queue picks jobs correctly
- Worker updates status in DB
- Output URLs resolve and download
- Delete history flow works
- Error handling and retries

### 10.2 Production Cutover

1. Deploy production stack.
2. Run migrations.
3. Warm up worker/api.
4. Switch DNS to ALB endpoint (low TTL beforehand).
5. Monitor for 30-60 minutes.

### 10.3 Rollback

If critical issues appear:
1. Repoint DNS to previous environment.
2. Scale down faulty deployment.
3. Restore from DB snapshot if needed.

## 11. Observability and Ops

- Logs: CloudWatch Container Insights or OpenTelemetry stack
- Metrics: Prometheus/Grafana or CloudWatch dashboards
- Alerts:
  - API 5xx spike
  - Worker queue depth too high
  - Job failure rate increase
  - RDS CPU/storage thresholds
- Tracing: optional but recommended for API/worker interactions

## 12. Security Checklist

- TLS everywhere (ALB + ACM)
- Private networking for RDS/Redis
- S3 block public access
- KMS encryption (RDS, S3, secrets)
- Least-privilege IAM for pods (IRSA)
- Rotate secrets regularly
- Add WAF on ALB for public endpoints

## 13. Cost Controls

- Use right-sized node groups and HPA
- Scale worker replicas based on queue depth
- S3 lifecycle to Glacier/expiry
- Enable RDS storage autoscaling with limits
- Use Savings Plans for steady workloads

## 14. Suggested Milestones

1. Milestone A: AWS infra ready (EKS, RDS, Redis, S3, ECR).
2. Milestone B: S3 adapter integrated and tested in dev.
3. Milestone C: EKS deployment working in staging.
4. Milestone D: Production cutover and post-cutover hardening.

## 15. Immediate Next Implementation Tasks in This Repo

1. Add S3 storage adapter and backend config switches.
2. Add Kubernetes manifests/Helm chart under infra/k8s.
3. Add CI/CD workflow for ECR + EKS deploy.
4. Add migration Kubernetes Job template.
5. Add operational docs for runbook and rollback.
