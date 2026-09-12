"""PDF text extraction with PyMuPDF and an OCR fallback for scanned gazette copies."""
from __future__ import annotations

import logging
import os
import re
import shutil
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

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


# Where Tesseract ends up on Windows. winget installs per-user when it is not run elevated, which puts it
# under LOCALAPPDATA and leaves it off PATH entirely -- so `which` alone reports no OCR on a machine that has
# it installed and working.
_TESSERACT_DIRS = (
    Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Tesseract-OCR",
    Path(r"C:\Program Files\Tesseract-OCR"),
    Path(r"C:\Program Files (x86)\Tesseract-OCR"),
)


@lru_cache(maxsize=1)
def _ocr_available() -> bool:
    """Whether OCR can run, arranging the environment it needs if so.

    Two things must be true, and only the first is obvious: the binary must be locatable, and PyMuPDF must be
    able to find the language data, which it reads from TESSDATA_PREFIX. Miss the second and OCR fails per
    page with a message about tessdata rather than saying it is not configured.
    """
    exe = shutil.which("tesseract")
    if not exe:
        for d in _TESSERACT_DIRS:
            candidate = d / "tesseract.exe"
            if candidate.is_file():
                os.environ["PATH"] = f"{d}{os.pathsep}{os.environ.get('PATH', '')}"
                exe = str(candidate)
                break
    if not exe:
        return False
    if not os.environ.get("TESSDATA_PREFIX"):
        tessdata = Path(exe).parent / "tessdata"
        if tessdata.is_dir():
            os.environ["TESSDATA_PREFIX"] = str(tessdata)
    log.info("OCR available: %s", exe)
    return True


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
