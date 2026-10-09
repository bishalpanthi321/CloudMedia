# Media Tool Webapp


![App Preview 1](preview_1.png)



# Implementation Flow

```mermaid
sequenceDiagram
	autonumber
	actor U as User
	participant F as Frontend
	participant A as API
	participant S as S3
	participant D as DB
	participant R as Queue
	participant W as Worker

	Note over U,F: Phase 1 - Upload
	U->>F: Select media and options
	F->>A: Request upload URL
	A-->>F: Return URL and input_key
	F->>S: Upload file

	Note over F,A: Phase 2 - Queue Job
	F->>A: Create job (input_key + options)
	A->>D: Save queued job row
	A->>R: Enqueue job id
	A-->>F: Return 202 and job id

	Note over R,W: Phase 3 - Process in Background
	W->>R: Dequeue job id
	W->>S: Download input media
	W->>W: Process (Pillow or FFmpeg)
	W->>S: Upload processed output
	W->>D: Update status (completed or failed)

	Note over F,A: Phase 4 - Retrieve Result
	F->>A: Poll job status
	A->>D: Read job state
	A->>S: Build output URL
	A-->>F: Return status and output_url
	F-->>U: Show processed result
```



**Core Responsibilities:**
* Led the architectural design for the decoupled Next.js frontend and FastAPI backend, Redis Queue Worker.
* Developed the core asynchronous worker logic (RQ/Redis), Auth module and implemented storage models for users and jobs.
* Created frontend UI designs and drafted the core user interaction flow.
* Configured the baseline containerization (`Dockerfile` and local `docker-compose.yml`).
* Performed debugging and testing to improve system reliability and ensured smooth user experience.
* Contributed to the project report sections on implementation and evaluation.
* Provisioned the AWS cloud environment and established the foundational infrastructure.
* Designed and implemented Identity and Access Management (IAM) policies to ensure secure, least-privilege access for the application.
* Configured the Amazon S3 buckets with appropriate CORS and access rules for media storage.
* Managed the Kubernetes deployment.
* Prepared and presented the video demo (alongside Shaheer).
* Managed the migration of the application from a local environment to the cloud infrastructure.
* Implemented the adapter patterns to connect the backend API and worker to the external AWS resources (RDS and S3).
* Managed the production environment variables (`.env.aws`) and the cloud-specific Docker Compose configurations.
* Worked on Project Report on project overview, Technology Stack & System Design + Conclusion
* Configured Amazon EKS cluster using eksctl, resolving IAM permission boundaries and account-level service restrictions
* Managed the container image pipeline end to end building, tagging, and pushing all three Docker images (frontend, API, worker) to Amazon ECR
* Set up the EKS environment with a node group and worker nodes; co-managed the Kubernetes deployment and debugged cloud deployment issues.
* Optimized the media processing pipeline for better performance and error handling.
* Refactored core application logic to add extended functionality and improve the user experience on the frontend.
* Set up the GitHub to AWS CI/CD pipeline.
* Prepared and presented the video demo (alongside Pau).
Current frontend URL (EKS LoadBalancer):
- http://a266dcd729d20463196b3dbfb6452e63-1911714493.ap-southeast-2.elb.amazonaws.com

Get the current URL from Kubernetes:

```bash
kubectl get svc frontend -n media-tool -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

Print it as a full URL:

```bash
echo "http://$(kubectl get svc frontend -n media-tool -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"
```

If hostname is empty, check service details:

```bash
kubectl get svc frontend -n media-tool -o wide
```

Check whole Kubernetes status (cluster + app namespace):

```bash
kubectl get nodes
kubectl get ns
kubectl get all -n media-tool
kubectl get ingress -n media-tool
kubectl get events -n media-tool --sort-by=.lastTimestamp | tail -n 30
```

Single command for quick app health summary:

```bash
kubectl get all -n media-tool -o wide
```

# Local Development

## Stack
- Frontend: Next.js (port 33001)
- API: FastAPI (port 33002)
- Postgres: port 33003
- Redis: port 33004
- Worker: RQ worker consuming media jobs

## Set Up .env
Create your local env file from the root template:

```bash
cp .env.example .env
```

Then update `.env` with your own values (at minimum):
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_DEFAULT_REGION`
- `AWS_S3_BUCKET_NAME`

Database mode is controlled by `.env`:
- Local Postgres mode (default):
	- `DATABASE_URL=postgresql+psycopg2://postgres:postgres@postgres:5432/media_tool`
- AWS RDS password mode:
	- `DATABASE_URL=postgresql+psycopg2://postgres:YOUR_PASSWORD@media-tool.c1cywo6eqqag.ap-southeast-2.rds.amazonaws.com:5432/postgres?sslmode=require`

The default local Docker values for `DATABASE_URL`, `REDIS_URL`, and ports in `.env.example` are already set for this project and can usually stay unchanged.

Important:
- Do not commit your real `.env` file.
- If secrets were ever exposed, rotate them in AWS immediately.

## Quick Start (Docker)
From repo root:

```bash
docker compose up --build -d
```

## Quick Start (AWS Postgres + Local Redis)
Use the migration compose file that points API/worker to external RDS and keeps Redis local:

```bash
docker compose -f docker-compose.aws.yml up --build -d
```

This mode reads settings from `.env.aws`.
Create it from your local env and adjust as needed:

```bash
cp .env .env.aws
```

Then ensure `.env.aws` has the correct `DATABASE_URL` for your remote RDS.

Stop it with:

```bash
docker compose -f docker-compose.aws.yml down
```

Open:
- Frontend: http://localhost:33001
- API docs: http://localhost:33002/docs

## Stop and Clean
Stop services:

```bash
docker compose down
```

Stop and remove volumes (resets DB and media data):

```bash
docker compose down -v
```

## View Logs
All services:

```bash
docker compose logs -f
```

Specific services:

```bash
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f frontend
```

## Migrations
Run alembic migrations inside API container:

```bash
docker compose exec api alembic upgrade head
```

Create a new migration:

```bash
docker compose exec api alembic revision -m "describe change"
```

## Useful Checks
Service status:

```bash
docker compose ps
```

Rebuild after code changes:

```bash
docker compose up --build -d
```

## Optional: Run Without Docker
This project is primarily set up for Docker Compose. If you run locally, match the same env values used in docker-compose.yml for DB, Redis, and API origins.

## Notes
- Media files are stored in project-root local_storage/ (mounted to /data/media in containers).
- Worker must be running for queued jobs to move from queued to processing/completed.
- If jobs do not progress, check worker logs first.

