#!/usr/bin/env python3
"""Analyze one Utahon practice track on a Mac and import the result over SSH."""

from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import importlib.metadata
import json
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal


STEMS = ("vocals", "drums", "bass", "other")
SAFE_SONG_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
SAFE_HOST = re.compile(r"^[A-Za-z0-9_.@-]{1,160}$")
SECTION_LABELS = {
    "intro": ("intro", "前奏"),
    "outro": ("outro", "尾奏"),
    "break": ("break", "间奏"),
    "inst": ("break", "器乐段"),
    "bridge": ("bridge", "桥段"),
    "solo": ("solo", "独奏"),
    "verse": ("verse", "主歌"),
    "chorus": ("chorus", "副歌"),
}


def log(message: str) -> None:
    print(f"[utahon-worker] {message}", flush=True)


CommandTool = Literal["python", "ffmpeg", "ssh", "scp"]


def command(
    tool: CommandTool,
    args: list[str],
    *,
    cwd: Path | None = None,
    capture: bool = False,
) -> str:
    executable = sys.executable if tool == "python" else tool
    # The executable is selected from CommandTool; arguments are passed without a shell.
    result = subprocess.run(
        [executable, *args],  # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit
        cwd=cwd,
        check=True,
        shell=False,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )
    return result.stdout if capture else ""


def remote_command(host: str, remote_root: str, args: list[str], *, capture: bool = False) -> str:
    script = f"cd {shlex.quote(remote_root)} && {shlex.join(args)}"
    return command("ssh", [host, script], capture=capture)


def last_json(output: str) -> dict[str, Any]:
    for line in reversed(output.splitlines()):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise RuntimeError("远端命令没有返回 JSON")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def chord_symbol(raw: str) -> str:
    value = raw.strip()
    if value == "N":
        return value
    if ":" not in value:
        return value
    root, quality = value.split(":", 1)
    # JAMS inversions use scale degrees (for example C:maj/3), while the
    # beginner sheet uses chord shapes. Drop the inversion instead of
    # pretending the scale degree is a bass-note name.
    quality = quality.split("/", 1)[0]
    replacements = {
        "maj": "",
        "min": "m",
        "min7": "m7",
        "min6": "m6",
        "min9": "m9",
        "maj7": "maj7",
        "maj9": "maj9",
        "hdim7": "m7b5",
    }
    suffix = replacements.get(quality, quality)
    return f"{root}{suffix}"


def simple_chord(symbol: str) -> str:
    if symbol == "N":
        return symbol
    match = re.match(r"^([A-G](?:#|b)?)(.*)$", symbol)
    if not match:
        return symbol
    root, quality = match.groups()
    lowered = quality.lower()
    suffix = ""
    if lowered.startswith("m") and not lowered.startswith("maj"):
        suffix = "m"
    if re.match(r"^(?:7|9|11|13|dom)", lowered):
        suffix = "7"
    if "dim" in lowered:
        suffix = "dim"
    if "aug" in lowered or "+" in lowered:
        suffix = "aug"
    if "sus2" in lowered:
        suffix = "sus2"
    elif "sus" in lowered:
        suffix = "sus4"
    return f"{root}{suffix}"


def merge_chords(raw_events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for item in raw_events:
        start = round(float(item["start_time"]), 3)
        end = round(float(item["end_time"]), 3)
        symbol = chord_symbol(str(item["chord"]))
        if end <= start:
            continue
        if merged and merged[-1]["symbol"] == symbol and start - merged[-1]["endTime"] <= 0.12:
            merged[-1]["endTime"] = end
            continue
        merged.append(
            {
                "id": f"auto-chord-{len(merged) + 1}",
                "startTime": start,
                "endTime": end,
                "symbol": symbol,
                "simplifiedSymbol": simple_chord(symbol),
                "source": "auto",
                "edited": False,
            }
        )
    return merged


def preserve_manual_events(
    automatic: list[dict[str, Any]], existing: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    manual = [event for event in existing if event.get("edited") or event.get("source") == "manual"]
    for event in manual:
        if event.get("label") == "full":
            continue
        start = float(event.get("startTime", 0))
        end = float(event.get("endTime", 0))
        automatic = [
            candidate
            for candidate in automatic
            if not (start <= (float(candidate["startTime"]) + float(candidate["endTime"])) / 2 < end)
        ]
    # Keep edited IDs stable; a fresh automatic pass may reuse their old IDs.
    used_ids: set[str] = set()
    unique: list[dict[str, Any]] = []
    for event in [*manual, *automatic]:
        item = dict(event)
        event_id = str(item.get("id", ""))
        if not event_id or event_id in used_ids:
            event_id = f"event-{uuid.uuid4()}"
        item["id"] = event_id
        used_ids.add(event_id)
        unique.append(item)
    return sorted(unique, key=lambda event: float(event.get("startTime", 0)))


def analyze_chords(wav_path: Path, existing: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from lv_chordia.chord_recognition import chord_recognition

    log("运行 lv-chordia 1.1.0 和弦识别")
    result = chord_recognition(audio_path=str(wav_path), chord_dict_name="ismir2017")
    if not isinstance(result, list):
        raise RuntimeError("lv-chordia 返回了无法识别的结果")
    return preserve_manual_events(merge_chords(result), existing)


def run_demucs(wav_path: Path, demix_dir: Path) -> None:
    import torch

    base = [
        "-m",
        "demucs.separate",
        "--out",
        str(demix_dir),
        "--name",
        "htdemucs",
    ]
    if torch.backends.mps.is_available():
        log("使用 Apple MPS 运行 Demucs 四轨分离")
        try:
            command("python", [*base, "--device", "mps", str(wav_path)])
            return
        except subprocess.CalledProcessError:
            log("MPS 分离失败，自动改用 CPU")
    command("python", [*base, "--device", "cpu", str(wav_path)])


def analyze_structure(
    wav_path: Path,
    work_dir: Path,
    model: str,
    existing_sections: list[dict[str, Any]],
) -> tuple[float | None, list[float], list[float], list[dict[str, Any]], Path]:
    import allin1

    demix_dir = work_dir / "demix"
    run_demucs(wav_path, demix_dir)
    log(f"运行 allin1 1.1.0 结构分析（{model}）")
    result = allin1.analyze(
        str(wav_path),
        out_dir=work_dir / "struct",
        model=model,
        device="cpu",
        demix_dir=demix_dir,
        spec_dir=work_dir / "spec",
        keep_byproducts=True,
        overwrite=True,
        multiprocess=False,
    )
    automatic: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    for segment in result.segments:
        mapped = SECTION_LABELS.get(str(segment.label))
        if not mapped or float(segment.end) <= float(segment.start):
            continue
        label, title = mapped
        counts[label] = counts.get(label, 0) + 1
        automatic.append(
            {
                "id": f"auto-section-{len(automatic) + 1}",
                "label": label,
                "title": f"{title} {counts[label]}",
                "startTime": round(float(segment.start), 3),
                "endTime": round(float(segment.end), 3),
                "source": "auto",
                "edited": False,
            }
        )
    sections = preserve_manual_events(automatic, existing_sections)
    stem_dir = demix_dir / "htdemucs" / wav_path.stem
    if not all((stem_dir / f"{stem}.wav").is_file() for stem in STEMS):
        raise RuntimeError("Demucs 没有生成完整的四轨文件")
    return (
        float(result.bpm) if result.bpm else None,
        [round(float(value), 3) for value in result.beats],
        [round(float(value), 3) for value in result.downbeats],
        sections,
        stem_dir,
    )


def encode_stems(stem_dir: Path, pack_dir: Path) -> dict[str, dict[str, str]]:
    files: dict[str, dict[str, str]] = {}
    for stem in STEMS:
        output = pack_dir / f"{stem}.m4a"
        command(
            "ffmpeg",
            [
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(stem_dir / f"{stem}.wav"),
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                str(output),
            ]
        )
        files[stem] = {"name": output.name, "sha256": sha256(output)}
    return files


def upload_pack(host: str, remote_root: str, pack_dir: Path) -> None:
    remote_name = f"worker-{uuid.uuid4()}"
    remote_relative = f"data/incoming/{remote_name}"
    remote_absolute = f"{remote_root.rstrip('/')}/{remote_relative}"
    remote_command(host, remote_root, ["mkdir", "-p", remote_relative])
    for item in pack_dir.iterdir():
        command("scp", [str(item), f"{host}:{remote_absolute}/{item.name}"])
    output = remote_command(
        host,
        remote_root,
        ["npm", "run", "practice:import", "--", remote_relative],
        capture=True,
    )
    result = last_json(output)
    log(
        f"导入完成：{result.get('chords', 0)} 个和弦，"
        f"{result.get('sections', 0)} 个段落，{len(result.get('stems', []))} 条分轨"
    )


def mark_failure(
    host: str,
    remote_root: str,
    song_id: str,
    audio_sha256: str,
    updated_at: int,
    message: str,
) -> None:
    encoded = base64.urlsafe_b64encode(message[:1000].encode("utf-8")).decode("ascii").rstrip("=")
    try:
        remote_command(
            host,
            remote_root,
            [
                "npm",
                "run",
                "practice:fail",
                "--",
                song_id,
                audio_sha256,
                str(updated_at),
                encoded,
            ],
        )
    except Exception:
        log("警告：无法把失败状态写回服务器")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="在本机分析一首 Utahon 练习音频并导回服务器")
    parser.add_argument("--song", required=True, help="Utahon song ID")
    parser.add_argument("--phase", choices=("chords", "all"), default="all")
    parser.add_argument("--host", default="2c2g5-c", help="SSH host alias")
    parser.add_argument("--remote-root", default="/opt/utahon")
    parser.add_argument("--allin-model", default="harmonix-fold0", choices=("harmonix-all", *[f"harmonix-fold{i}" for i in range(8)]))
    parser.add_argument("--keep-workdir", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not SAFE_SONG_ID.fullmatch(args.song):
        raise SystemExit("song ID 格式无效")
    if not SAFE_HOST.fullmatch(args.host):
        raise SystemExit("SSH host 格式无效")
    if not args.remote_root.startswith("/") or any(char in args.remote_root for char in "\n\r"):
        raise SystemExit("远端目录必须是绝对路径")
    if not shutil.which("ffmpeg") or not shutil.which("ssh") or not shutil.which("scp"):
        raise SystemExit("需要 ffmpeg、ssh 和 scp")

    if args.keep_workdir:
        work_dir = Path(tempfile.mkdtemp(prefix="utahon-worker-"))
        cleanup = None
    else:
        cleanup = tempfile.TemporaryDirectory(prefix="utahon-worker-")
        work_dir = Path(cleanup.name)

    info: dict[str, object] | None = None
    try:
        log("读取服务器上的当前音频与练习数据")
        inspect_output = remote_command(
            args.host,
            args.remote_root,
            ["npm", "run", "practice:inspect", "--", args.song],
            capture=True,
        )
        info = last_json(inspect_output)
        audio_path = Path(str(info["audioPath"]))
        if audio_path.is_absolute() or ".." in audio_path.parts:
            raise RuntimeError("远端返回了不安全的音频路径")
        local_mix = work_dir / "mix.m4a"
        remote_audio = f"{args.remote_root.rstrip('/')}/{audio_path.as_posix()}"
        command("scp", [f"{args.host}:{remote_audio}", str(local_mix)])
        if sha256(local_mix) != info["audioSha256"]:
            raise RuntimeError("下载音频的 SHA-256 与服务器记录不一致")

        wav_path = work_dir / "mix.wav"
        command(
            "ffmpeg",
            [
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(local_mix),
                "-ar",
                "44100",
                "-ac",
                "2",
                str(wav_path),
            ]
        )
        data = copy.deepcopy(info["data"])
        data["chords"] = analyze_chords(wav_path, list(data.get("chords", [])))
        analyzers = dict(data.get("analyzers", {}))
        analyzers["lv-chordia"] = importlib.metadata.version("lv-chordia")
        files: dict[str, dict[str, str]] = {}

        pack_dir = work_dir / "pack"
        pack_dir.mkdir()
        if args.phase == "all":
            bpm, beats, downbeats, sections, stem_dir = analyze_structure(
                wav_path,
                work_dir,
                args.allin_model,
                list(data.get("sections", [])),
            )
            data["bpm"] = bpm
            data["beats"] = beats
            data["downbeats"] = downbeats
            data["sections"] = sections
            data["stems"] = list(STEMS)
            analyzers["allin1"] = importlib.metadata.version("allin1")
            analyzers["demucs"] = importlib.metadata.version("demucs")
            files = encode_stems(stem_dir, pack_dir)
        data["analyzers"] = analyzers

        manifest = {
            "version": 1,
            "songId": args.song,
            "audioSha256": info["audioSha256"],
            "baseUpdatedAt": info["updatedAt"],
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "data": data,
            "files": files,
        }
        (pack_dir / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        upload_pack(args.host, args.remote_root, pack_dir)
        if args.keep_workdir:
            log(f"工作目录已保留：{work_dir}")
        return 0
    except Exception as error:
        if info is not None:
            mark_failure(
                args.host,
                args.remote_root,
                args.song,
                str(info["audioSha256"]),
                int(info["updatedAt"]),
                str(error),
            )
        log(f"失败：{error}")
        if args.keep_workdir:
            log(f"工作目录已保留：{work_dir}")
        return 1
    finally:
        if cleanup is not None:
            cleanup.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
