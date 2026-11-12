"""Business logic: documents, sharing, import. No HTTP, no SQL in here."""
from pathlib import PurePosixPath

from app.errors import AppError

MAX_IMPORT_BYTES = 2 * 1024 * 1024


def validate_import(filename: str, text: str) -> str:
    """Returns the lowercase extension if the upload is acceptable."""
    from app.importers import IMPORTERS

    ext = PurePosixPath(filename.replace("\\", "/")).suffix.lower()
    if ext not in IMPORTERS:
        raise AppError(415, "unsupported_type", "Only .md and .txt files can be imported")
    if len(text.encode("utf-8")) > MAX_IMPORT_BYTES:
        raise AppError(413, "file_too_large", "File is larger than the 2 MB limit")
    if not text.strip():
        raise AppError(400, "empty_file", "The file is empty")
    return ext
