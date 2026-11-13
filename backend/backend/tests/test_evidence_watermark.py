import shutil
import subprocess
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageChops, ImageDraw

from app.services.evidence_watermark import (
    _capture_label,
    resolve_ffmpeg_executable,
    watermark_image,
    watermark_video,
)


class EvidenceWatermarkTests(unittest.TestCase):
    def test_label_includes_operator_time_and_coordinates(self) -> None:
        self.assertEqual(
            _capture_label(datetime(2026, 10, 27, 11, 14, 45), 809772, 4.60971, -74.08175),
            "809772 - 27/10/2026 11:14:45\n4.60971, -74.08175",
        )

    def test_image_has_visible_watermark(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            destination = Path(directory) / "result.jpg"
            Image.new("RGB", (640, 480), "white").save(source)
            with patch.object(ImageDraw.ImageDraw, "multiline_text", autospec=True,
                              side_effect=ImageDraw.ImageDraw.multiline_text) as draw_text:
                watermark_image(
                    source, destination, datetime(2026, 10, 27, 11, 14, 45),
                    809772, 4.60971, -74.08175,
                )
            self.assertEqual(
                draw_text.call_args.args[2],
                "809772 - 27/10/2026 11:14:45\n4.60971, -74.08175",
            )
            with Image.open(destination) as result:
                self.assertIsNotNone(ImageChops.difference(
                    result.convert("RGB"), Image.new("RGB", result.size, "white"),
                ).getbbox())

    def test_video_has_visible_watermark(self) -> None:
        ffmpeg = resolve_ffmpeg_executable("ffmpeg")
        if not Path(ffmpeg).is_file() and not shutil.which(ffmpeg):
            self.skipTest("FFmpeg no está instalado")
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.mp4"
            destination = Path(directory) / "result.mp4"
            frame = Path(directory) / "frame.png"
            subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
                 "-i", "color=c=white:s=640x480:d=1", "-c:v", "libx264", str(source)],
                check=True, capture_output=True,
            )
            with patch("app.services.evidence_watermark._capture_label", wraps=_capture_label) as label:
                watermark_video(
                    source, destination, datetime(2026, 10, 27, 11, 14, 45),
                    809772, 4.60971, -74.08175,
                )
            label.assert_called_once_with(datetime(2026, 10, 27, 11, 14, 45),
                                          809772, 4.60971, -74.08175)
            subprocess.run(
                [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(destination),
                 "-frames:v", "1", str(frame)],
                check=True, capture_output=True,
            )
            with Image.open(frame) as result:
                self.assertLess(result.convert("L").getextrema()[0], 100)
