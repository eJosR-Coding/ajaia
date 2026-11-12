"""Importers: markdown/text conversion, and the validation rules."""
import pytest

from app.importers import IMPORTERS, derive_title, md_to_html, txt_to_html
from app.errors import AppError
from app.services import validate_import

MAX = 2 * 1024 * 1024


def test_markdown_headings_lists_emphasis():
    html = md_to_html("# Title\n\n## Sub\n\n- a\n- b\n\nbreak\n\n1. x\n\nsome **bold** and *it*")
    assert "<h1>Title</h1>" in html and "<h2>Sub</h2>" in html
    assert "<ul>" in html and "<ol>" in html
    assert "<strong>bold</strong>" in html and "<em>it</em>" in html


def test_markdown_script_is_stripped_after_sanitize():
    from app.sanitize import clean_html
    assert "<script" not in clean_html(md_to_html("hi <script>alert(1)</script>"))


def test_text_becomes_paragraphs_and_escapes():
    html = txt_to_html("one\ntwo\n\nthree <b>")
    assert html == "<p>one<br>two</p><p>three &lt;b&gt;</p>"


def test_registry_only_md_and_txt():
    assert set(IMPORTERS) == {".md", ".txt"}


def test_title_from_first_heading_else_filename():
    assert derive_title("notes.md", "intro\n\n# Real Title\n") == "Real Title"
    assert derive_title("my_notes.txt", "just text") == "my_notes"
    assert derive_title(".md", "") == "Untitled"


def test_validate_rejects_unsupported_extension():
    with pytest.raises(AppError) as e:
        validate_import("a.docx", "x")
    assert e.value.status == 415


def test_validate_rejects_too_big():
    with pytest.raises(AppError) as e:
        validate_import("a.txt", "x" * (MAX + 1))
    assert e.value.status == 413


def test_validate_rejects_empty():
    with pytest.raises(AppError) as e:
        validate_import("a.md", "   ")
    assert e.value.status == 400


def test_validate_ok():
    assert validate_import("A.MD", "# hi") == ".md"
