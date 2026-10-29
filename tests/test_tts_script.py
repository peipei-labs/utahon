import asyncio
import importlib.util
import io
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "synthesize_tts", Path(__file__).parents[1] / "scripts" / "synthesize-tts.py"
)
tts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tts)


class TtsScriptTests(unittest.TestCase):
    def test_forwards_voice_and_speed_and_collects_only_audio(self):
        calls = []

        class Communicate:
            def __init__(self, text, **options):
                calls.append((text, options))

            async def stream(self):
                yield {"type": "WordBoundary", "text": "ignored"}
                yield {"type": "audio", "data": b"one"}
                yield {"type": "audio", "data": b"two"}

        with patch.dict(sys.modules, {"edge_tts": types.SimpleNamespace(Communicate=Communicate)}):
            result = asyncio.run(tts.synthesize({"text": "こんにちは", "voice": "ja-JP-KeitaNeural", "rate": "-40%"}))
        self.assertEqual(result, b"onetwo")
        self.assertEqual(calls, [("こんにちは", {"voice": "ja-JP-KeitaNeural", "rate": "-40%", "connect_timeout": 5, "receive_timeout": 10})])

    def test_failure_does_not_write_audio_or_expose_exception(self):
        class Communicate:
            def __init__(self, *_args, **_kwargs):
                pass

            async def stream(self):
                yield {"type": "audio", "data": b"partial"}
                raise RuntimeError("upstream URL token=secret and input text")

        output = types.SimpleNamespace(buffer=io.BytesIO())
        errors = io.StringIO()
        request = io.StringIO('{"text":"test","voice":"ja-JP-NanamiNeural","rate":"+0%"}')
        with patch.dict(sys.modules, {"edge_tts": types.SimpleNamespace(Communicate=Communicate)}), patch.object(sys, "stdin", request), patch.object(sys, "stdout", output), patch.object(sys, "stderr", errors):
            status = tts.main()
        self.assertEqual(status, 1)
        self.assertEqual(output.buffer.getvalue(), b"")
        self.assertEqual(errors.getvalue(), "Speech synthesis failed\n")


if __name__ == "__main__":
    unittest.main()
