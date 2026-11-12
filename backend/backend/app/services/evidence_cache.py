"""Persistent local read-through cache for remote evidence files."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import logging
import os
from pathlib import Path
import json
import secrets
import subprocess
import tempfile
from threading import Lock
import time
from typing import Callable

from PIL import Image, ImageOps

from app.core.config import get_settings
from app.services.evidence_watermark import resolve_ffmpeg_executable

logger = logging.getLogger(__name__)

THUMBNAIL_SIZE = (480, 480)
THUMBNAIL_QUALITY = 72
COPY_CHUNK_SIZE = 1024 * 1024


@dataclass(frozen=True)
class EvidenceCacheResult:
    path: Path
    cache_status: str
    response_source: str
    kind: str
    size_bytes: int
    source_read_ms: float = 0.0
    local_read_ms: float = 0.0
    cache_write_ms: float = 0.0


class EvidenceCache:
    """Stores derivatives and frequently used originals on the container disk.

    Cache keys include the canonical source path, file length, and mtime_ns.
    Cached files are replaced atomically and evicted least-recently-used first.
    """

    def __init__(self) -> None:
        settings = get_settings()
        configured_root = settings.evidence_cache_path
        if not configured_root and os.name == "nt":
            configured_root = str(Path(tempfile.gettempdir()) / "appmovil-cache")
        self.root = Path(configured_root or "/var/cache/appmovil")
        self.thumbnails_dir = self.root / "evidence-thumbnails"
        self.originals_dir = self.root / "evidence-originals"
        self.videos_dir = self.root / "evidence-videos"
        self.stream_grants_dir = self.root / "evidence-stream-grants"
        self.thumbnail_max_bytes = settings.evidence_thumbnail_cache_max_bytes
        self.original_max_bytes = settings.evidence_original_cache_max_bytes
        self.video_max_bytes = settings.evidence_video_cache_max_bytes
        self.video_max_file_bytes = settings.evidence_video_cache_max_file_bytes
        self.expiry_seconds = max(0, settings.evidence_cache_expiry_seconds)
        self.cleanup_interval_seconds = max(
            60, settings.evidence_cache_cleanup_interval_seconds
        )
        self._locks: dict[str, Lock] = {}
        self._locks_guard = Lock()
        self._cleanup_lock = Lock()
        self._last_cleanup = 0.0

    def store_thumbnail_from_image(
        self,
        source: Path,
        image: Image.Image,
    ) -> EvidenceCacheResult:
        """Generate and cache a thumbnail from an already-decoded upload image."""
        stat = source.stat()
        key = self._cache_key(source, stat)
        started = time.perf_counter()

        def write_thumbnail(temporary_path: Path) -> float:
            thumbnail = ImageOps.exif_transpose(image).convert("RGB")
            thumbnail.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
            thumbnail.save(
                temporary_path,
                format="JPEG",
                quality=THUMBNAIL_QUALITY,
                optimize=True,
            )
            return 0.0

        result = self._get_or_fill(
            key=key,
            directory=self.thumbnails_dir,
            suffix=".jpg",
            max_bytes=self.thumbnail_max_bytes,
            kind="thumbnail",
            fill=write_thumbnail,
            source_read_ms=0.0,
            response_source="upload-memory",
        )
        return EvidenceCacheResult(
            **{
                **result.__dict__,
                "cache_write_ms": (time.perf_counter() - started) * 1000,
            }
        )

    def get_thumbnail(self, source: Path) -> EvidenceCacheResult:
        if source.suffix.lower() in {".mp4", ".mov"}:
            return self._video_thumbnail(source, response_source="sshfs")
        stat = source.stat()
        key = self._cache_key(source, stat)

        def write_thumbnail(temporary_path: Path) -> float:
            started = time.perf_counter()
            with Image.open(source) as opened:
                image = ImageOps.exif_transpose(opened).convert("RGB")
            source_read_ms = (time.perf_counter() - started) * 1000
            image.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
            image.save(
                temporary_path,
                format="JPEG",
                quality=THUMBNAIL_QUALITY,
                optimize=True,
            )
            return source_read_ms

        return self._get_or_fill(
            key=key,
            directory=self.thumbnails_dir,
            suffix=".jpg",
            max_bytes=self.thumbnail_max_bytes,
            kind="thumbnail",
            fill=write_thumbnail,
            response_source="sshfs",
        )

    def store_video_thumbnail(self, source: Path) -> EvidenceCacheResult:
        """Create the first-frame poster for a video already written to storage."""
        return self._video_thumbnail(source, response_source="upload-local")

    def _video_thumbnail(self, source: Path, *, response_source: str) -> EvidenceCacheResult:
        stat = source.stat()
        key = self._cache_key(source, stat)

        def make_poster(temporary_path: Path) -> float:
            started = time.perf_counter()
            subprocess.run(
                [
                    resolve_ffmpeg_executable("ffmpeg"), "-hide_banner", "-loglevel", "error",
                    "-y", "-ss", "0", "-i", str(source), "-frames:v", "1",
                    "-vf", "scale=480:480:force_original_aspect_ratio=decrease",
                    "-q:v", "5", "-c:v", "mjpeg", "-f", "image2", "-update", "1",
                    str(temporary_path),
                ],
                check=True,
                capture_output=True,
                timeout=60,
            )
            return (time.perf_counter() - started) * 1000 if response_source == "sshfs" else 0.0

        started = time.perf_counter()
        result = self._get_or_fill(
            key=key,
            directory=self.thumbnails_dir,
            suffix=".jpg",
            max_bytes=self.thumbnail_max_bytes,
            kind="video-thumbnail",
            fill=make_poster,
            response_source=response_source,
        )
        return EvidenceCacheResult(
            **{**result.__dict__, "cache_write_ms": max(result.cache_write_ms, (time.perf_counter() - started) * 1000)}
        )

    def get_original_image(self, source: Path) -> EvidenceCacheResult:
        stat = source.stat()
        key = self._cache_key(source, stat)
        if stat.st_size > self.original_max_bytes:
            return EvidenceCacheResult(
                path=source,
                cache_status="bypass",
                response_source="sshfs",
                kind="original-image",
                size_bytes=stat.st_size,
            )
        return self._get_or_fill(
            key=key,
            directory=self.originals_dir,
            suffix=source.suffix.lower(),
            max_bytes=self.original_max_bytes,
            kind="original-image",
            fill=lambda temporary_path: self._copy_source(source, temporary_path),
            response_source="sshfs",
            bypass_path=source,
        )

    def get_video_if_small(self, source: Path) -> EvidenceCacheResult:
        stat = source.stat()
        if stat.st_size > min(self.video_max_file_bytes, self.video_max_bytes):
            return EvidenceCacheResult(
                path=source,
                cache_status="bypass",
                response_source="sshfs",
                kind="video",
                size_bytes=stat.st_size,
            )

        key = self._cache_key(source, stat)
        return self._get_or_fill(
            key=key,
            directory=self.videos_dir,
            suffix=source.suffix.lower(),
            max_bytes=self.video_max_bytes,
            kind="video",
            fill=lambda temporary_path: self._copy_source(source, temporary_path),
            response_source="sshfs",
            bypass_path=source,
        )

    def issue_video_stream_grant(
        self,
        *,
        task_id: int,
        filename: str,
        document_type: str,
        identification: str,
        ttl_seconds: int = 3600,
    ) -> str:
        token = secrets.token_urlsafe(32)
        directory = self.stream_grants_dir
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(directory, 0o700)
        grant_path = directory / f"{token}.json"
        payload = {
            "task_id": task_id,
            "filename": filename,
            "document_type": document_type,
            "identification": identification,
            "expires_at": int(time.time()) + ttl_seconds,
        }
        descriptor, temporary_name = tempfile.mkstemp(prefix="grant-", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                json.dump(payload, stream, separators=(",", ":"))
            os.chmod(temporary_name, 0o600)
            os.replace(temporary_name, grant_path)
        finally:
            Path(temporary_name).unlink(missing_ok=True)
        return token

    def get_video_stream_grant(self, token: str) -> dict[str, int | str] | None:
        if len(token) > 64 or not all(character.isalnum() or character in "-_" for character in token):
            return None
        grant_path = self.stream_grants_dir / f"{token}.json"
        try:
            with grant_path.open("r", encoding="utf-8") as stream:
                payload = json.load(stream)
            if not isinstance(payload, dict) or int(payload.get("expires_at", 0)) < int(time.time()):
                grant_path.unlink(missing_ok=True)
                return None
            return payload
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return None

    def _copy_source(self, source: Path, destination: Path) -> float:
        source_read_ms = 0.0
        with source.open("rb") as source_file, destination.open("wb") as target:
            while True:
                started = time.perf_counter()
                chunk = source_file.read(COPY_CHUNK_SIZE)
                source_read_ms += (time.perf_counter() - started) * 1000
                if not chunk:
                    break
                target.write(chunk)
        return source_read_ms

    def _get_or_fill(
        self,
        *,
        key: str,
        directory: Path,
        suffix: str,
        max_bytes: int,
        kind: str,
        fill: Callable[[Path], float | None],
        source_read_ms: float = 0.0,
        response_source: str,
        bypass_path: Path | None = None,
    ) -> EvidenceCacheResult:
        self._cleanup_if_due()
        target = directory / f"{key}{suffix}"
        lookup_started = time.perf_counter()
        directory.mkdir(parents=True, exist_ok=True)
        lock = self._lock_for(key)
        with lock:
            if target.is_file() and target.stat().st_size > 0:
                target_stat = target.stat()
                expired = (
                    self.expiry_seconds > 0
                    and time.time_ns() - target_stat.st_atime_ns
                    > self.expiry_seconds * 1_000_000_000
                )
                if expired:
                    target.unlink(missing_ok=True)
                else:
                    self._touch(target)
                    return EvidenceCacheResult(
                        path=target,
                        cache_status="hit",
                        response_source="local-cache",
                        kind=kind,
                        size_bytes=target_stat.st_size,
                        local_read_ms=(time.perf_counter() - lookup_started) * 1000,
                    )

            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f"{key}.", suffix=".tmp", dir=directory
            )
            os.close(descriptor)
            temporary_path = Path(temporary_name)
            started = time.perf_counter()
            try:
                measured_source_read_ms = fill(temporary_path) or source_read_ms
                if temporary_path.stat().st_size > max_bytes:
                    if bypass_path is None:
                        raise OSError(
                            f"Generated {kind} exceeds the configured cache limit."
                        )
                    return EvidenceCacheResult(
                        path=bypass_path,
                        cache_status="bypass",
                        response_source=response_source,
                        kind=kind,
                        size_bytes=bypass_path.stat().st_size,
                        source_read_ms=measured_source_read_ms,
                        cache_write_ms=(time.perf_counter() - started) * 1000,
                    )
                os.replace(temporary_path, target)
                self._touch(target)
                self._evict(
                    directory,
                    max_bytes,
                    keep=target,
                    expiry_seconds=self.expiry_seconds,
                )
                return EvidenceCacheResult(
                    path=target,
                    cache_status="miss",
                    response_source="local-cache",
                    kind=kind,
                    size_bytes=target.stat().st_size,
                    source_read_ms=measured_source_read_ms,
                    cache_write_ms=(time.perf_counter() - started) * 1000,
                )
            finally:
                temporary_path.unlink(missing_ok=True)

    def _cache_key(self, source: Path, stat: os.stat_result) -> str:
        identity = f"{source.resolve()}:{stat.st_size}:{stat.st_mtime_ns}"
        return sha256(identity.encode("utf-8")).hexdigest()

    def _cleanup_if_due(self) -> None:
        now = time.monotonic()
        if now - self._last_cleanup < self.cleanup_interval_seconds:
            return
        with self._cleanup_lock:
            now = time.monotonic()
            if now - self._last_cleanup < self.cleanup_interval_seconds:
                return
            for directory in (self.thumbnails_dir, self.originals_dir, self.videos_dir):
                self._evict(directory, self._limit_for(directory), keep=None, expiry_seconds=self.expiry_seconds)
            self._cleanup_stream_grants()
            self._last_cleanup = now

    def _cleanup_stream_grants(self) -> None:
        if not self.stream_grants_dir.exists():
            return
        now_seconds = int(time.time())
        for grant_path in self.stream_grants_dir.glob("*.json"):
            try:
                with grant_path.open("r", encoding="utf-8") as stream:
                    expires_at = int(json.load(stream).get("expires_at", 0))
                if expires_at < now_seconds:
                    grant_path.unlink(missing_ok=True)
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                grant_path.unlink(missing_ok=True)

    def _limit_for(self, directory: Path) -> int:
        if directory == self.thumbnails_dir:
            return self.thumbnail_max_bytes
        if directory == self.originals_dir:
            return self.original_max_bytes
        return self.video_max_bytes

    def _lock_for(self, key: str) -> Lock:
        with self._locks_guard:
            if len(self._locks) > 4096:
                self._locks = {
                    lock_key: lock
                    for lock_key, lock in self._locks.items()
                    if lock.locked()
                }
            return self._locks.setdefault(key, Lock())

    @staticmethod
    def _touch(path: Path) -> None:
        try:
            stat = path.stat()
            os.utime(path, ns=(time.time_ns(), stat.st_mtime_ns))
        except OSError:
            logger.debug("Could not update evidence cache recency.", exc_info=True)

    @staticmethod
    def _evict(
        directory: Path,
        max_bytes: int,
        *,
        keep: Path | None,
        expiry_seconds: int = 0,
    ) -> None:
        if not directory.exists():
            return
        entries: list[tuple[int, int, Path]] = []
        total_bytes = 0
        cutoff_ns = time.time_ns() - expiry_seconds * 1_000_000_000
        for path in directory.iterdir():
            if not path.is_file():
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            if path.suffix == ".tmp":
                # A process crash can leave an atomic-fill temp file behind.
                # Keep active writes safe while removing abandoned files later.
                if stat.st_mtime_ns < time.time_ns() - 3600 * 1_000_000_000:
                    try:
                        path.unlink(missing_ok=True)
                    except OSError:
                        logger.warning("Could not remove an abandoned evidence cache temp file.", exc_info=True)
                continue
            total_bytes += stat.st_size
            if expiry_seconds and stat.st_atime_ns < cutoff_ns and path != keep:
                try:
                    path.unlink(missing_ok=True)
                    total_bytes -= stat.st_size
                except OSError:
                    logger.warning("Could not expire an evidence cache file: file=%s", path.name, exc_info=True)
            elif path != keep:
                entries.append((stat.st_atime_ns, stat.st_size, path))

        for _, size_bytes, path in sorted(entries):
            if total_bytes <= max_bytes:
                break
            try:
                path.unlink(missing_ok=True)
                total_bytes -= size_bytes
            except OSError:
                logger.warning("Could not evict an evidence cache file.", exc_info=True)


_evidence_cache: EvidenceCache | None = None
_evidence_cache_guard = Lock()


def get_evidence_cache() -> EvidenceCache:
    global _evidence_cache
    if _evidence_cache is None:
        with _evidence_cache_guard:
            if _evidence_cache is None:
                _evidence_cache = EvidenceCache()
    return _evidence_cache
