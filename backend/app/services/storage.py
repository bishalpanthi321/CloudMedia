from pathlib import Path

import boto3
from botocore.exceptions import ClientError

from app.core.config import get_settings

settings = get_settings()


class S3ObjectStorage:
    """S3 adapter used for direct browser uploads and direct media access."""

    def __init__(
        self,
        bucket_name: str,
        region_name: str,
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
    ):
        self.bucket_name = bucket_name
        client_kwargs: dict[str, str] = {"region_name": region_name}
        if access_key_id and secret_access_key:
            client_kwargs["aws_access_key_id"] = access_key_id
            client_kwargs["aws_secret_access_key"] = secret_access_key
        self.client = boto3.client("s3", **client_kwargs)

    def generate_upload_url(self, key: str, content_type: str, expires_in: int) -> str:
        return self.client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self.bucket_name,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=expires_in,
        )

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket_name, Key=key)
            return True
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in {"404", "NotFound", "NoSuchKey"}:
                return False
            raise

    def read_bytes(self, key: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket_name, Key=key)
        return response["Body"].read()

    def write_bytes(self, key: str, content: bytes, content_type: str | None = None) -> None:
        kwargs = {
            "Bucket": self.bucket_name,
            "Key": key,
            "Body": content,
        }
        if content_type:
            kwargs["ContentType"] = content_type
        self.client.put_object(**kwargs)

    def download_to_path(self, key: str, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket_name, key, str(destination))

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket_name, Key=key)

    def public_url(self, key: str, expires_in: int) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket_name, "Key": key},
            ExpiresIn=expires_in,
        )


class LocalObjectStorage:
    """Local adapter that keeps an S3-like key-based interface for easy future swap."""

    def __init__(self, media_root: str):
        self.media_root = Path(media_root)
        self.uploads_dir = self.media_root / "uploads"
        self.outputs_dir = self.media_root / "outputs"
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.outputs_dir.mkdir(parents=True, exist_ok=True)

    def save_upload(self, key: str, content: bytes) -> Path:
        path = self.media_root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def generate_upload_url(self, key: str, content_type: str, expires_in: int) -> str:
        raise RuntimeError("Direct upload URLs require S3 storage")

    def exists(self, key: str) -> bool:
        return (self.media_root / key).exists()

    def read_bytes(self, key: str) -> bytes:
        return (self.media_root / key).read_bytes()

    def write_bytes(self, key: str, content: bytes, content_type: str | None = None) -> Path:
        path = self.media_root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def download_to_path(self, key: str, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(self.read_bytes(key))

    def delete(self, key: str) -> None:
        self.absolute_path(key).unlink(missing_ok=True)

    def absolute_path(self, key: str) -> Path:
        return self.media_root / key

    @staticmethod
    def public_url(key: str, expires_in: int) -> str:
        return f"/media/{key}"


if settings.aws_s3_bucket_name:
    storage = S3ObjectStorage(
        bucket_name=settings.aws_s3_bucket_name,
        region_name=settings.aws_default_region,
        access_key_id=settings.aws_access_key_id,
        secret_access_key=settings.aws_secret_access_key,
    )
else:
    storage = LocalObjectStorage(settings.media_root)
