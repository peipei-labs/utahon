import asyncio
import json
import sys


async def synthesize(request):
    import edge_tts

    audio = bytearray()
    communicate = edge_tts.Communicate(
        request["text"],
        voice=request["voice"],
        rate=request["rate"],
        connect_timeout=5,
        receive_timeout=10,
    )
    async for part in communicate.stream():
        if part["type"] == "audio":
            audio.extend(part["data"])
    if not audio:
        raise RuntimeError("empty audio")
    return audio


def main():
    try:
        request = json.load(sys.stdin)
        audio = asyncio.run(synthesize(request))
        sys.stdout.buffer.write(audio)
        sys.stdout.buffer.flush()
    except Exception:
        print("Speech synthesis failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
