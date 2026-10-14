import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "utahon_analyze", Path(__file__).resolve().parents[1] / "audio-worker" / "utahon_analyze.py"
)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerMergeTests(unittest.TestCase):
    def test_edited_ids_survive_without_duplicate_automatic_ids(self):
        edited = {"id": "auto-chord-1", "startTime": 10, "endTime": 12, "symbol": "G", "edited": True}
        automatic = [
            {"id": "auto-chord-1", "startTime": 0, "endTime": 2, "symbol": "C"},
            {"id": "auto-chord-2", "startTime": 10, "endTime": 12, "symbol": "D"},
        ]
        result = worker.preserve_manual_events(automatic, [edited])
        self.assertEqual(len(result), 2)
        self.assertEqual(result[1], edited)
        self.assertNotEqual(result[0]["id"], edited["id"])
        self.assertEqual(automatic[0]["id"], "auto-chord-1")

    def test_rerunning_keeps_ids_unique_for_sections_too(self):
        existing = [
            {"id": "auto-section-1", "startTime": 10, "endTime": 12, "label": "chorus", "source": "manual"},
            {"id": "full", "startTime": 0, "endTime": 20, "label": "full", "source": "manual"},
        ]
        automatic = [{"id": "auto-section-1", "startTime": 0, "endTime": 8, "label": "verse"}]
        first = worker.preserve_manual_events(automatic, existing)
        second = worker.preserve_manual_events(automatic, first)
        self.assertEqual(len(second), 3)
        self.assertEqual(len({item["id"] for item in second}), 3)
        self.assertEqual(sum(item["label"] == "full" for item in second), 1)

    def test_legacy_duplicates_are_given_independent_ids(self):
        events = [{"id": "duplicate", "startTime": n, "endTime": n + 1, "source": "manual"} for n in (0, 5)]
        result = worker.preserve_manual_events([], events)
        self.assertEqual(len(result), 2)
        self.assertEqual(len({item["id"] for item in result}), 2)


if __name__ == "__main__":
    unittest.main()
