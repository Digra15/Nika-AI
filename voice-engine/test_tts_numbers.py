import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tts_engine import clean_text_for_tts  # noqa: E402


class TestIndonesianTTSNormalization(unittest.TestCase):
    def test_thousand_separated_numbers(self) -> None:
        self.assertEqual(
            clean_text_for_tts("279.819"),
            "dua ratus tujuh puluh sembilan ribu delapan ratus sembilan belas",
        )
        self.assertEqual(
            clean_text_for_tts("Rp 1.500.000"),
            "satu juta lima ratus ribu rupiah",
        )
        self.assertEqual(clean_text_for_tts("200"), "dua ratus")
        self.assertEqual(clean_text_for_tts("1000"), "seribu")

    def test_dates_times_decimals_and_units(self) -> None:
        self.assertEqual(clean_text_for_tts("13 Agustus"), "tiga belas Agustus")
        self.assertEqual(
            clean_text_for_tts("13/08/2026"),
            "tiga belas Agustus dua ribu dua puluh enam",
        )
        self.assertEqual(
            clean_text_for_tts("14:05 WIB"),
            "empat belas nol lima waktu indonesia barat",
        )
        self.assertEqual(
            clean_text_for_tts("36,5°C"),
            "tiga puluh enam koma lima derajat celcius",
        )


if __name__ == "__main__":
    unittest.main()
