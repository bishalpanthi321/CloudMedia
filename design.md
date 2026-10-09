

This setup includes **Next.js** (frontend), **FastAPI** (backend API), **RQ Worker**, **Redis**, and **PostgreSQL** — exactly as you asked.

The goal is simple:  

- Run **everything locally** with one command (`docker compose up`).  

- Keep the **API fast and responsive**.  

- Let the **Worker** handle all heavy image/video processing in the background.  

- Use **Redis + RQ** for the queue system.  

- Use **PostgreSQL** for storing job metadata and results.  

- Next.js talks to the FastAPI backend.

### Docker Services We Need (5 containers total)

| Service Name | Docker Image (what we build or use) | Responsible For | Key Details |

|--------------|-------------------------------------|-----------------|-------------|

| **postgres** | Official `postgres:16-alpine` | Database | Stores all job information (file names, status, result URLs, user data). Persistent volume so data survives restarts. |

| **redis**    | Official `redis:7-alpine` | Queue + Cache | Acts as the message broker for RQ. Stores pending jobs and temporary cache. |

| **api**      | Your custom image (built from Dockerfile) | FastAPI Backend API | Receives uploads from Next.js frontend, saves metadata to PostgreSQL, **enqueues** jobs into Redis using RQ, returns job ID immediately. Runs the FastAPI server (uvicorn). |

| **worker**   | Same custom image as `api` (or a very similar one) | RQ Background Worker | Continuously listens to the Redis queue (`media-queue`). Picks up jobs, downloads files from S3, resizes + adds watermark (using FFmpeg/Pillow), uploads result back to S3, and updates PostgreSQL status. This is the **heavy processing part**. |

| **frontend** | Your custom image (built from Next.js Dockerfile) | Next.js Frontend | The user interface (upload form, progress tracking, gallery of processed files). Calls the `api` service via HTTP. Built in production mode for best performance. |

### How the API + Worker Structure Works with Redis + RQ

- **API and Worker share the same codebase** (same Docker image).  

  This keeps things simple — you only maintain one set of Python files.

- **API (FastAPI)** responsibility:

  - Handles all HTTP requests from Next.js (e.g. `/upload`, `/process`, `/job-status`).

  - Never does slow work itself.

  - When a user uploads a file:

    1. Saves basic info to PostgreSQL.

    2. Puts a small “job ticket” into Redis using RQ.

    3. Immediately replies to Next.js with a job ID (user sees “Processing started…”).

- **Worker (RQ)** responsibility:

  - Runs the command `rq worker media-queue`.

  - Watches Redis for new jobs.

  - When it finds a job, it executes the media processing function (resize + watermark).

  - Updates PostgreSQL when done (status = completed/failed + result URL).

  - You can run **multiple worker containers** if you have many videos (easy scaling).

- **Redis + RQ glue**:

  - Redis holds the queue.

  - RQ is the library that lets the API “enqueue” jobs and the worker “dequeue + run” them.

  - No direct communication between API and Worker — everything goes through Redis.

- **Next.js** only talks to the **api** service (never directly to worker or databases). It polls the API for job status to show progress to the user.

### Connection Summary (how they talk to each other)

- `frontend` → calls `api` (via internal Docker network on port 8000)

- `api` → writes to `postgres` + enqueues to `redis`

- `worker` → reads from `redis` + writes to `postgres`

- All services communicate using service names (`postgres`, `redis`, `api`) — no IP addresses needed.

### Why This Plan Is Perfect for Your AWS + Kubernetes Goal

- Local Docker Compose = fast development and testing.

- Same Docker images you build here will be pushed to Amazon ECR and used on EKS later.

- The `api` and `worker` structure is identical to what we will deploy in Kubernetes (just different manifests).

- Easy to add S3 later (presigned URLs from the API).

### Next Steps After This Plan (high-level, no code)

1. Create one Dockerfile for the Python part (FastAPI + Worker + FFmpeg installed).

2. Create a separate Dockerfile for Next.js.

3. Create the `docker-compose.yml` file that defines the 5 services above.

4. Run `docker compose up --build` → everything starts.

5. Open browser → Next.js on port 3000 → test upload → watch worker logs.

6. Once happy locally, we move to Kubernetes manifests (same images, same structure).