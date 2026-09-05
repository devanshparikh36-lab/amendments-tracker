"""PDF text extraction with PyMuPDF and an OCR fallback for scanned gazette copies."""
from __future__ import annotations

import logging
import re
import shutil
from dataclasses import dataclass

import fitz  # PyMuPDF

log = logging.getLogger(__name__)

MIN_CHARS_PER_PAGE = 200  # below this the page is treated as scanned


@dataclass
class PdfText:
    text: str
    page_count: int
    ocr_used: bool


def _clean(text: str) -> str:
    text = text.replace("\x00", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _ocr_available() -> bool:
    return shutil.which("tesseract") is not None


def extract_pdf_text(data: bytes) -> PdfText:
    doc = fitz.open(stream=data, filetype="pdf")
    pages: list[str] = []
    ocr_used = False
    for page in doc:
        text = page.get_text("text")
        if len(text.strip()) < MIN_CHARS_PER_PAGE and _ocr_available():
            try:
                tp = page.get_textpage_ocr(language="eng", dpi=300, full=True)
                text = page.get_text("text", textpage=tp)
                ocr_used = True
            except Exception as exc:  # tesseract missing tessdata etc.
                log.warning("OCR failed on page %d: %s", page.number, exc)
        pages.append(text)
    doc.close()
    return PdfText(text=_clean("\n\n".join(pages)), page_count=len(pages), ocr_used=ocr_used)
