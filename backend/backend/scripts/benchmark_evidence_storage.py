#!/usr/bin/env python3
"""Compare sequential reads from SSHFS with a local copy of the same evidence.

Run this on the Linux application host, not inside a container whose evidence
mount may have a different cache or network path:

    python3 scripts/benchmark_evidence_storage.py \
      --local-dir /var/tmp \
      /mnt/evidencias_appmovil/<operator>/<task>/<image>.jpg \
      /mnt/evidencias_appmovil/<operator>/<task>/<video>.mp4

The script only reads the supplied evidence. Its temporary local copies are
removed when it exits.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import statistics
import tempfile
import time
from pathlib import Path
from typing import Any

CHUNK_SIZE = 1024 * 1024


def read_file(path: Path) -> tuple[int, float, float]:
    """Return bytes read, time to first byte (ms), and full read time (ms)."""
    started = time.perf_counter()
    bytes_read = 0
    with path.open("rb", buffering=0) as evidence_file:
        first_byte = evidence_file.read(1)
        first_byte_ms = (time.perf_counter() - started) * 1000
        bytes_read += len(first_byte)
        while chunk := evidence_file.read(CHUNK_SIZE):
            bytes_read += len(chunk)
    elapsed_ms = (time.perf_counter() - started) * 1000
    return bytes_read, first_byte_ms, elapsed_ms


def percentile(values: list[float], percent: float) -> float:
    ordered = sorted(values)
    position = max(0, math.ceil(percent * len(ordered)) - 1)
    return ordered[position]


def read_samples(path: Path, runs: int) -> dict[str, Any]:
    times: list[float] = []
    first_byte_times: list[float] = []
    bytes_read = 0
    for _ in range(runs):
        bytes_read, first_byte_ms, elapsed_ms = read_file(path)
        times.append(elapsed_ms)
        first_byte_times.append(first_byte_ms)
    return {
        "bytes_read": bytes_read,
        "full_read_ms_median": round(statistics.median(times), 2),
        "full_read_ms_p95": round(percentile(times, 0.95), 2),
        "first_byte_ms_median": round(statistics.median(first_byte_times), 2),
        "throughput_mib_s_median": round(
            bytes_read / (statistics.median(times) / 1000) / (1024 * 1024), 2
        ),
    }


def stat_samples(path: Path, runs: int) -> dict[str, float]:
    times: list[float] = []
    for _ in range(runs):
        started = time.perf_counter()
        path.stat()
        times.append((time.perf_counter() - started) * 1000)
    return {
        "latency_ms_median": round(statistics.median(times), 2),
        "latency_ms_p95": round(percentile(times, 0.95), 2),
    }


def benchmark(source: Path, local_dir: Path, runs: int) -> dict[str, Any]:
    if not source.is_file():
        raise FileNotFoundError(f"No es un archivo accesible: {source}")

    source = source.resolve()
    stat_started = time.perf_counter()
    size_bytes = source.stat().st_size
    sshfs_initial_stat_ms = (time.perf_counter() - stat_started) * 1000
    first_bytes, first_byte_ms, first_read_ms = read_file(source)

    with tempfile.TemporaryDirectory(prefix="appmovil-evidence-bench-", dir=local_dir) as temp:
        local_copy = Path(temp) / source.name
        copy_started = time.perf_counter()
        shutil.copyfile(source, local_copy)
        copy_ms = (time.perf_counter() - copy_started) * 1000

        sshfs_stat = stat_samples(source, runs)
        local_stat = stat_samples(local_copy, runs)
        sshfs_warm = read_samples(source, runs)
        local_warm = read_samples(local_copy, runs)

    return {
        "file": source.name,
        "size_bytes": size_bytes,
        "sshfs_initial_stat_ms": round(sshfs_initial_stat_ms, 2),
        "sshfs_first_observed_read_ms": round(first_read_ms, 2),
        "sshfs_first_byte_ms": round(first_byte_ms, 2),
        "sshfs_to_local_copy_ms": round(copy_ms, 2),
        "sshfs_warm_stat": sshfs_stat,
        "local_warm_stat": local_stat,
        "sshfs_warm": sshfs_warm,
        "local_copy_warm": local_warm,
        "warm_read_speedup": round(
            sshfs_warm["full_read_ms_median"]
            / max(local_warm["full_read_ms_median"], 0.01),
            2,
        ),
        "initial_read_bytes": first_bytes,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="+", type=Path, help="Archivos reales en SSHFS")
    parser.add_argument(
        "--sshfs-root",
        type=Path,
        default=Path("/mnt/evidencias_appmovil"),
        help="Raíz SSHFS (default: /mnt/evidencias_appmovil)",
    )
    parser.add_argument(
        "--local-dir",
        type=Path,
        default=Path("/var/tmp"),
        help="Directorio local al servidor, nunca dentro del montaje SSHFS",
    )
    parser.add_argument("--runs", type=int, default=7, help="Lecturas repetidas (default: 7)")
    args = parser.parse_args()
    if args.runs < 3:
        parser.error("--runs debe ser al menos 3")

    sshfs_root = args.sshfs_root.resolve()
    if not sshfs_root.is_mount():
        parser.error(f"No parece ser un punto de montaje activo: {sshfs_root}")
    local_dir = args.local_dir.resolve()
    if local_dir.is_relative_to(sshfs_root):
        parser.error("--local-dir debe estar fuera del montaje SSHFS")
    local_dir.mkdir(parents=True, exist_ok=True)
    for source in args.files:
        if not source.resolve().is_relative_to(sshfs_root):
            parser.error(f"El archivo fuente debe estar dentro de SSHFS: {source}")

    results = [benchmark(source, local_dir, args.runs) for source in args.files]
    print(json.dumps({
        "local_dir": str(local_dir),
        "runs_per_path": args.runs,
        "results": results,
        "notes": [
            "La primera lectura SSHFS tiene estado de caché desconocido.",
            "Las medianas repetidas representan lecturas calientes del mismo archivo.",
            "La copia local acaba de escribirse y normalmente está en la page cache del kernel.",
            "sshfs_to_local_copy_ms incluye lectura SSHFS y escritura local; no es lectura pura.",
        ],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
