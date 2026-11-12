"""App factory + the single error handler (one JSON error shape everywhere)."""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.errors import AppError
from app.routes import router


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def create_app() -> FastAPI:
    app = FastAPI(title="Ajaia Docs", docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(AppError)
    async def _app_error(_: Request, e: AppError):
        return _error(e.status, e.code, e.message)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, e: RequestValidationError):
        first = e.errors()[0] if e.errors() else {}
        loc = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        return _error(422, "validation_error", f"Invalid request: {loc} {first.get('msg', '')}".strip())

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        code = "not_found" if e.status_code == 404 else "http_error"
        return _error(e.status_code, code, str(e.detail))

    app.include_router(router)
    return app


app = create_app()
