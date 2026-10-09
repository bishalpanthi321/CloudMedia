from redis import Redis
from rq import Worker

from app.core.config import get_settings


def main() -> None:
    settings = get_settings()
    redis_conn = Redis.from_url(settings.redis_url)

    worker = Worker([settings.queue_name], connection=redis_conn)
    worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
