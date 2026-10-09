import subprocess
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from app.core.config import get_settings
from app.models.job import MediaType

settings = get_settings()


def process_media(
    media_type: MediaType,
    input_path: Path,
    requested_width: int | None,
    watermark_text: str | None,
    text_overlays: list[dict[str, Any]] | None,
) -> tuple[bytes, str]:
    if media_type == MediaType.image:
        return _process_image(input_path, requested_width, watermark_text, text_overlays)
    return _process_video(input_path, requested_width, watermark_text, text_overlays)


def _process_image(
    input_path: Path,
    requested_width: int | None,
    watermark_text: str | None,
    text_overlays: list[dict[str, Any]] | None,
) -> tuple[bytes, str]:
    target_width = requested_width or settings.max_image_width
    mark = (watermark_text or "").strip()
    overlays = _normalize_text_overlays(text_overlays)

    with Image.open(input_path) as image:
        image = image.convert("RGBA")
        source_width = image.width
        source_height = image.height

        if image.width > target_width:
            ratio = target_width / float(image.width)
            target_height = int(image.height * ratio)
            image = image.resize((target_width, target_height), Image.Resampling.LANCZOS)

        merged = image
        if overlays:
            txt_layer = Image.new("RGBA", image.size, (255, 255, 255, 0))
            draw = ImageDraw.Draw(txt_layer)
            scale_x = image.width / float(max(source_width, 1))
            scale_y = image.height / float(max(source_height, 1))

            for overlay in overlays:
                x = int(round(overlay["x"] * scale_x))
                y = int(round(overlay["y"] * scale_y))
                font_size = max(12, int(round(overlay["font_size"] * scale_y)))
                font = _load_font(font_size)
                rgb = _hex_to_rgb(overlay.get("color") or "#ffffff")
                draw.text((x, y), overlay["text"], font=font, fill=(rgb[0], rgb[1], rgb[2], 180))

            merged = Image.alpha_composite(image, txt_layer)
        elif mark:
            txt_layer = Image.new("RGBA", image.size, (255, 255, 255, 0))
            draw = ImageDraw.Draw(txt_layer)
            font = ImageFont.load_default()
            text_width = draw.textlength(mark, font=font)
            x = max(10, image.width - int(text_width) - 24)
            y = max(10, image.height - 26)
            draw.text((x, y), mark, font=font, fill=(255, 255, 255, 180))
            merged = Image.alpha_composite(image, txt_layer)

        merged = merged.convert("RGB")

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp_file:
            temp_name = tmp_file.name

        try:
            merged.save(temp_name, format="JPEG", quality=90)
            output = Path(temp_name).read_bytes()
        finally:
            Path(temp_name).unlink(missing_ok=True)

    return output, "jpg"


def _process_video(
    input_path: Path,
    requested_width: int | None,
    watermark_text: str | None,
    text_overlays: list[dict[str, Any]] | None,
) -> tuple[bytes, str]:
    mark = (watermark_text or "").strip()
    overlays = _normalize_text_overlays(text_overlays)

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp_file:
        output_path = Path(tmp_file.name)

    text_paths: list[Path] = []
    video_filters: list[str] = []

    if overlays:
        for overlay in overlays:
            with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as text_file:
                text_file.write(overlay["text"])
                text_path = Path(text_file.name)
                text_paths.append(text_path)

            escaped_text_path = _escape_ffmpeg_filter_value(str(text_path))
            x = max(0, int(round(overlay["x"])))
            y = max(0, int(round(overlay["y"])))
            font_size = max(12, int(round(overlay["font_size"])))
            ffmpeg_color = _to_ffmpeg_color(overlay.get("color") or "#ffffff")
            video_filters.append(
                f"drawtext=textfile='{escaped_text_path}':fontcolor={ffmpeg_color}:fontsize={font_size}:x={x}:y={y}"
            )
    elif mark:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as text_file:
            text_file.write(mark)
            text_path = Path(text_file.name)
            text_paths.append(text_path)

        escaped_text_path = _escape_ffmpeg_filter_value(str(text_path))
        video_filters.append(
            f"drawtext=textfile='{escaped_text_path}':fontcolor=white:fontsize=24:x=w-tw-20:y=h-th-20"
        )

    if requested_width and requested_width > 0:
        target_width = int(requested_width)
        # Keep overlays in source coordinates, then downscale in the same pass.
        # Do not upscale beyond source width; clamp width to an even value for x264.
        video_filters.append(f"scale='trunc(min(iw\\,{target_width})/2)*2':-2")

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
    ]

    if video_filters:
        cmd.extend([
            "-vf",
            ",".join(video_filters),
        ])

    cmd.extend([
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        str(output_path),
    ])

    try:
        subprocess.run(cmd, check=True, capture_output=True)
        output = output_path.read_bytes()
    except subprocess.CalledProcessError as exc:
        error = exc.stderr.decode("utf-8", errors="ignore")
        raise RuntimeError(f"ffmpeg failed: {error}") from exc
    finally:
        output_path.unlink(missing_ok=True)
        for text_path in text_paths:
            text_path.unlink(missing_ok=True)

    return output, "mp4"


def _normalize_text_overlays(text_overlays: list[dict[str, Any]] | None) -> list[dict[str, float | str]]:
    normalized: list[dict[str, float | str]] = []
    for raw in text_overlays or []:
        text = str(raw.get("text", "")).strip()
        if not text:
            continue

        try:
            x = float(raw.get("x", 0))
            y = float(raw.get("y", 0))
            font_size = float(raw.get("font_size", 24))
        except (TypeError, ValueError):
            continue

        normalized.append(
            {
                "text": text,
                "x": max(0.0, x),
                "y": max(0.0, y),
                "font_size": max(1.0, font_size),
                "color": _normalize_hex_color(raw.get("color")),
            }
        )

    return normalized


def _load_font(font_size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype("DejaVuSans.ttf", font_size)
    except OSError:
        return ImageFont.load_default()


def _escape_ffmpeg_filter_value(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace(",", "\\,")
        .replace("'", "\\'")
    )


def _normalize_hex_color(value: Any) -> str:
    candidate = str(value or "").strip()
    if candidate.startswith("#") and len(candidate) == 7:
        hex_part = candidate[1:]
        if all(char in "0123456789abcdefABCDEF" for char in hex_part):
            return f"#{hex_part.lower()}"

    return "#ffffff"


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    normalized = _normalize_hex_color(value)
    return (
        int(normalized[1:3], 16),
        int(normalized[3:5], 16),
        int(normalized[5:7], 16),
    )


def _to_ffmpeg_color(value: str) -> str:
    normalized = _normalize_hex_color(value)
    return f"0x{normalized[1:]}"
