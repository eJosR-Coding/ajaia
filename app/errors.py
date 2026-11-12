"""One error type, one JSON shape: {"error": {"code", "message"}}."""


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def not_found() -> AppError:
    # same answer for "missing" and "not yours" so we never leak existence
    return AppError(404, "not_found", "Document not found")


def conflict() -> AppError:
    return AppError(409, "conflict", "This document was changed elsewhere")
