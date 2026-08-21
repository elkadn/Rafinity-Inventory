import numpy as np

from app import ocr


class FakeReader:
    def __init__(self):
        self.calls = []

    def readtext(self, image, detail=1, allowlist=None, paragraph=False, batch_size=1):
        self.calls.append((image.shape, allowlist, batch_size))
        return [([0, 0], "123456", 0.95)]


def test_fast_ocr_uses_single_rotation(monkeypatch):
    fake_reader = FakeReader()
    monkeypatch.setattr(ocr, "_get_reader", lambda: fake_reader)

    class DummySettings:
        CODE_MIN_DIGITS = 4
        CODE_MAX_DIGITS = 10

    gray = np.zeros((100, 100), dtype=np.uint8)
    candidates = ocr._ocr_easyocr(gray, DummySettings(), quick=True)

    assert candidates == ["123456"]
    assert len(fake_reader.calls) == 1
