from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[2] / "scripts" / "benchmark_production_sidecar.py"
SPEC = importlib.util.spec_from_file_location("benchmark_production_sidecar", SCRIPT)
assert SPEC and SPEC.loader
benchmark = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = benchmark
SPEC.loader.exec_module(benchmark)


class BenchmarkTests(unittest.TestCase):
    def test_streaming_peak_is_bounded_below_direct_materialization(self) -> None:
        result = benchmark.run_benchmark(8 * 1024 * 1024, 256 * 1024)
        self.assertEqual(result["workloadBytes"], 8 * 1024 * 1024)
        self.assertGreater(result["directPeakBytes"], result["sidecarPeakBytes"] * 8)
        self.assertTrue(result["sidecarIntegrityVerified"])


if __name__ == "__main__":
    unittest.main()
