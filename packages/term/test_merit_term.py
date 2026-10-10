import importlib.util
import os
import unittest

spec = importlib.util.spec_from_file_location("merit_term", os.path.join(os.path.dirname(__file__), "merit_term.py"))
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)


def classes(data: bytes):
    return [c for c, _ in mt.classify_chunk(data)]


class ClassifyTest(unittest.TestCase):
    def test_typing_one_key_per_read(self):
        self.assertEqual(classes(b"a"), ["char"])
        self.assertEqual(classes(b" "), ["space"])
        self.assertEqual(classes(b"\r"), ["enter"])
        self.assertEqual(classes(b"\x7f"), ["back"])
        self.assertEqual(classes(b"\x1b[3~"), ["del"])

    def test_navigation_and_selection(self):
        self.assertEqual(classes(b"\x1b[D"), ["nav"])
        self.assertEqual(classes(b"\x1b[1;2D"), ["select"])

    def test_bracketed_paste_counts_length_not_content(self):
        out = mt.classify_chunk(b"\x1b[200~hello world\x1b[201~")
        self.assertEqual(out, [("paste", 11)])

    def test_unbracketed_bulk_paste_heuristic(self):
        self.assertEqual(mt.classify_chunk(b"this came in all at once"), [("paste", 24)])

    def test_short_run_is_typing(self):
        self.assertEqual(classes(b"ab"), ["char", "char"])

    def test_utf8_counts_characters(self):
        self.assertEqual(classes("é".encode()), ["char"])


if __name__ == "__main__":
    unittest.main()
