import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "scripts" / "fetch_kind_listed_stocks.py"


def load_module():
    spec = importlib.util.spec_from_file_location("fetch_kind_listed_stocks", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FetchKindListedStocksTest(unittest.TestCase):
    def test_main_uses_existing_cache_when_kind_refresh_is_forbidden(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "listed-stocks.json"
            cached_payload = {
                "generatedAt": "2026-06-08T00:00:00+00:00",
                "source": "cached",
                "count": 1,
                "lookup": {"삼성전자": "005930"},
                "stocks": [{"companyName": "삼성전자", "stockCode": "005930"}],
            }
            output_path.write_text(json.dumps(cached_payload, ensure_ascii=False), encoding="utf-8")

            module.OUTPUT_PATH = output_path
            module.fetch_kind_html = lambda: (_ for _ in ()).throw(
                RuntimeError("HTTP Error 403: Forbidden")
            )

            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                module.main()

            self.assertEqual(json.loads(output_path.read_text(encoding="utf-8")), cached_payload)
            result = json.loads(stdout.getvalue())
            self.assertEqual(result["fallback"], "existing-listed-stocks-cache")
            self.assertEqual(result["count"], 1)

    def test_main_raises_when_refresh_fails_without_valid_cache(self):
        module = load_module()
        with tempfile.TemporaryDirectory() as tmpdir:
            module.OUTPUT_PATH = Path(tmpdir) / "listed-stocks.json"
            module.fetch_kind_html = lambda: (_ for _ in ()).throw(
                RuntimeError("HTTP Error 403: Forbidden")
            )

            with contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(RuntimeError):
                    module.main()


if __name__ == "__main__":
    unittest.main()
