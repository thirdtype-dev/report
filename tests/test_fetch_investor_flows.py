import importlib.util
import os
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "fetch_investor_flows.py"
SPEC = importlib.util.spec_from_file_location("fetch_investor_flows", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


FIXTURE = """
<table class="type_1">
  <tr><th>날짜</th><th>개인</th><th>외국인</th><th>기관계</th></tr>
  <tr>
    <td class="date2">26.07.10</td>
    <td class="rate_down3">-7,722</td>
    <td class="rate_down3">-3,226</td>
    <td class="rate_up3">11,314</td>
    <td class="rate_up3">11,192</td>
    <td class="rate_up3">579</td>
    <td class="rate_down3">-1,342</td>
    <td class="rate_up3">69</td>
    <td class="rate_up3">460</td>
    <td class="rate_up3">355</td>
    <td class="rate_down3">-366</td>
  </tr>
  <tr>
    <td class="date2">26.07.09</td>
    <td class="rate_down3">-13,278</td>
    <td class="rate_up3">1,343</td>
    <td class="rate_up3">12,884</td>
    <td class="rate_up3">2,822</td>
    <td class="rate_up3">950</td>
    <td class="rate_up3">7,921</td>
    <td class="rate_up3">1</td>
    <td class="rate_up3">454</td>
    <td class="rate_up3">736</td>
    <td class="rate_down3">-950</td>
  </tr>
</table>
"""


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.body


class InvestorFlowParserTest(unittest.TestCase):
    def test_parses_naver_rows_and_converts_eok_to_krw(self):
        rows = MODULE.parse_naver_investor_rows(FIXTURE)

        self.assertEqual(rows[-1]["date"], "2026-07-10")
        self.assertEqual(rows[-1]["netBuy"]["retail"], -772_200_000_000)
        self.assertEqual(rows[-1]["netBuy"]["foreign"], -322_600_000_000)
        self.assertEqual(rows[-1]["netBuy"]["institution"], 1_131_400_000_000)

    def test_fetches_current_market_with_complete_three_party_values(self):
        def open_url(request, timeout):
            self.assertIn("bizdate=20260710", request.full_url)
            self.assertIn("sosok=01", request.full_url)
            self.assertEqual(timeout, 20)
            return FakeResponse(FIXTURE.encode("euc-kr"))

        market = MODULE.fetch_naver_market("KOSPI", date(2026, 7, 10), open_url=open_url)

        self.assertEqual(market["latestDate"], "2026-07-10")
        self.assertEqual(market["source"], "NAVER Finance/KRX")
        self.assertTrue({"foreign", "institution", "retail"} <= market["netBuy"].keys())
        self.assertEqual(market["streaks"]["foreign"], {"direction": "sell", "count": 1})

    def test_empty_table_is_a_source_error_not_a_valid_empty_market(self):
        with self.assertRaisesRegex(RuntimeError, "empty_naver_investor_flow_rows"):
            MODULE.parse_naver_investor_rows("<table><tr><td>no data</td></tr></table>")

    def test_pykrx_fallback_requires_explicit_credentials(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "missing_krx_credentials"):
                MODULE.load_pykrx_stock()


if __name__ == "__main__":
    unittest.main()
