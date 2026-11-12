"""HTTP layer: Pydantic models in, JSON out. No rules live here."""
from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from app.deps import (COOKIE_NAME, Settings, check_db, current_user, get_repos,
                      get_service, get_settings)
from app.errors import AppError
from app.models import Document, User
from app.security import SESSION_TTL, sign_session, verify_password

router = APIRouter(prefix="/api")


class LoginIn(BaseModel):
    email: str
    password: str


class CreateIn(BaseModel):
    title: str | None = None


class RenameIn(BaseModel):
    title: str


class SaveIn(BaseModel):
    content_html: str
    revision: int


class ImportIn(BaseModel):
    filename: str
    text: str


class ShareIn(BaseModel):
    email: str


def user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name}


def meta_out(d: Document, viewer: User) -> dict:
    return {"id": d.id, "title": d.title, "revision": d.revision,
            "owner_id": d.owner_id, "is_owner": d.owner_id == viewer.id,
            "updated_at": d.updated_at.isoformat() if d.updated_at else None}


def doc_out(d: Document, viewer: User) -> dict:
    return {**meta_out(d, viewer), "content_html": d.content_html}


@router.get("/health")
def health(ok: bool = Depends(check_db)):
    if not ok:
        raise AppError(503, "db_unavailable", "Database is not reachable")
    return {"status": "ok", "db": "ok"}


@router.post("/auth/login")
def login(body: LoginIn, response: Response, repos=Depends(get_repos),
          settings: Settings = Depends(get_settings)):
    user = repos.users.get_by_email(body.email.strip().lower())
    if user is None or not verify_password(body.password, user.password_hash):
        raise AppError(401, "invalid_credentials", "Wrong email or password")
    response.set_cookie(COOKIE_NAME, sign_session(user.id, settings.session_secret),
                        max_age=SESSION_TTL, httponly=True, samesite="lax",
                        secure=settings.cookie_secure, path="/")
    return user_out(user)


@router.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


@router.get("/documents")
def list_documents(user: User = Depends(current_user), svc=Depends(get_service)):
    owned, shared = svc.list(user)
    return {"owned": [meta_out(d, user) for d in owned],
            "shared": [meta_out(d, user) for d in shared]}


@router.post("/documents", status_code=201)
def create_document(body: CreateIn, user: User = Depends(current_user), svc=Depends(get_service)):
    return doc_out(svc.create(user, body.title), user)


# declared before /documents/{doc_id} routes so "import" is never read as an id
@router.post("/documents/import", status_code=201)
def import_document(body: ImportIn, user: User = Depends(current_user), svc=Depends(get_service)):
    return doc_out(svc.import_file(user, body.filename, body.text), user)


@router.get("/documents/{doc_id}")
def get_document(doc_id: int, user: User = Depends(current_user), svc=Depends(get_service)):
    return doc_out(svc.get(user, doc_id), user)


@router.patch("/documents/{doc_id}")
def rename_document(doc_id: int, body: RenameIn, user: User = Depends(current_user),
                    svc=Depends(get_service)):
    return doc_out(svc.rename(user, doc_id, body.title), user)


@router.put("/documents/{doc_id}")
def save_document(doc_id: int, body: SaveIn, user: User = Depends(current_user),
                  svc=Depends(get_service)):
    return doc_out(svc.save(user, doc_id, body.content_html, body.revision), user)


@router.get("/documents/{doc_id}/shares")
def list_shares(doc_id: int, user: User = Depends(current_user), svc=Depends(get_service)):
    return [user_out(u) for u in svc.list_shares(user, doc_id)]


@router.post("/documents/{doc_id}/shares")
def share_document(doc_id: int, body: ShareIn, user: User = Depends(current_user),
                   svc=Depends(get_service)):
    return user_out(svc.share(user, doc_id, body.email))


@router.get("/documents/{doc_id}/versions")
def list_versions(doc_id: int, user: User = Depends(current_user), svc=Depends(get_service)):
    return [{"id": v.id, "title": v.title, "created_at": v.created_at.isoformat()}
            for v in svc.list_versions(user, doc_id)]


@router.post("/documents/{doc_id}/versions/{version_id}/restore")
def restore_version(doc_id: int, version_id: int, user: User = Depends(current_user),
                    svc=Depends(get_service)):
    return doc_out(svc.restore_version(user, doc_id, version_id), user)
