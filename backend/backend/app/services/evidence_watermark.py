"""Bake a local capture timestamp into evidence before permanent storage."""

from datetime import datetime
import glob
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from collections.abc import Callable

from PIL import Image, ImageDraw, ImageFont, ImageOps


def watermark_image(
    source: Path,
    destination: Path,
    captured_at: datetime,
    *,
    on_processed: Callable[[Image.Image], None] | None = None,
) -> None:
    try:
        from pillow_heif import register_heif_opener

        register_heif_opener()
    except ImportError:
        pass

    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    draw = ImageDraw.Draw(image)
    label = captured_at.strftime("%d/%m/%Y %H:%M:%S")
    font_size = max(18, round(image.width * 0.035))
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", font_size)
    except OSError:
        font = ImageFont.load_default()
    padding = max(10, round(font_size * 0.45))
    bounds = draw.textbbox((0, 0), label, font=font, stroke_width=0)
    text_width, text_height = bounds[2] - bounds[0], bounds[3] - bounds[1]
    x = max(padding, image.width - text_width - padding * 2)
    y = max(padding, image.height - text_height - padding * 2)
    draw.rounded_rectangle(
        (x - padding, y - padding, x + text_width + padding, y + text_height + padding),
        radius=max(4, padding // 2),
        fill=(12, 20, 30),
    )
    draw.text((x, y), label, font=font, fill=(255, 255, 255), stroke_width=0)
    image.save(destination, format="JPEG", quality=90, optimize=True)
    if on_processed:
        on_processed(image)


def watermark_video(source: Path, destination: Path, captured_at: datetime) -> None:
    label = captured_at.strftime("%d/%m/%Y %H:%M:%S")
    with tempfile.TemporaryDirectory(prefix="evidence-watermark-") as temp_dir:
        text_file = Path(temp_dir) / "timestamp.txt"
        text_file.write_text(label, encoding="utf-8")
        font_file = (
            Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "arial.ttf"
            if os.name == "nt"
            else Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
        )
        font_path = _escape_filter_path(font_file)
        text_path = _escape_filter_path(text_file)
        filter_value = (
            # Use an explicit platform font and escape paths for FFmpeg's filter parser.
            f"drawtext=fontfile='{font_path}':"
            "fontsize=h*0.035:fontcolor=white:"
            "box=1:boxcolor=0x0C141E@0.75:boxborderw=12:"
            f"x=w-text_w-24:y=h-text_h-24:textfile='{text_path}':reload=0"
        )
        subprocess.run(
            [
                resolve_ffmpeg_executable("ffmpeg"),
                "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
                "-vf", filter_value, "-map", "0:v:0", "-map", "0:a?",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart", str(destination),
            ],
            check=True,
            capture_output=True,
            timeout=600,
        )


def _escape_filter_path(path: Path) -> str:
    """Escape a path used as a quoted FFmpeg filter option value."""
    return path.resolve().as_posix().replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def resolve_ffmpeg_executable(name: str) -> str:
    """Find FFmpeg tools on PATH or in a standard per-user winget install."""
    configured = os.environ.get(f"{name.upper()}_PATH")
    if configured:
        return configured

    executable = shutil.which(name)
    if executable:
        return executable

    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            package_root = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
            pattern = str(
                package_root
                / "Gyan.FFmpeg.Shared_*"
                / "ffmpeg-*-full_build-shared"
                / "bin"
                / f"{name}.exe"
            )
            matches = glob.glob(pattern)
            if matches:
                return matches[-1]

    return name
