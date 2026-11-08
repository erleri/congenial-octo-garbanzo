"""Offline PDF text snapshot, not a numeric parser or evidence approval.

Caller bounds execution time. No network, OCR, JavaScript or embedded files.
Keep page text unchanged so a reviewer can bind exact excerpts to the PDF hash.
"""
import hashlib
import io
import json
import pathlib
import sys

import pypdf


def extract(filename, profile="monthly"):
    source = pathlib.Path(filename)
    if source.stat().st_size > 2_000_000:
        raise ValueError("pdf_too_large")
    raw = source.read_bytes()
    if not raw.startswith(b"%PDF-") or b"%%EOF" not in raw[-2048:]:
        raise ValueError("invalid_pdf")
    reader = pypdf.PdfReader(io.BytesIO(raw), strict=True)
    if profile not in ("monthly", "statistical-bulletin"):
        raise ValueError("unsupported_profile")
    max_pages = 96 if profile == "statistical-bulletin" else 24
    if reader.is_encrypted or not 1 <= len(reader.pages) <= max_pages:
        raise ValueError("unsupported_pdf")
    pages = []
    for number, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ""
        if len(text) > 40_000:
            raise ValueError("page_text_too_large")
        pages.append({"page": number, "text": text,
                      "textHash": hashlib.sha256(text.encode("utf-8")).hexdigest()})
    return {"version": "monthly-pdf-text/1", "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw), "extractor": "pypdf/" + pypdf.__version__, "pages": pages}


if __name__ == "__main__":
    if len(sys.argv) not in (2, 4) or len(sys.argv) == 4 and sys.argv[2] != "--profile":
        raise SystemExit("usage: extract-monthly-pdf.py <captured-pdf> [--profile statistical-bulletin]")
    print(json.dumps(extract(sys.argv[1], sys.argv[3] if len(sys.argv) == 4 else "monthly"), ensure_ascii=False))
