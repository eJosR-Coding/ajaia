"""Turn uploaded text into editor HTML. Only .md and .txt, on purpose."""
import html as htmllib
import re
from pathlib import PurePosixPath

import markdown


def md_to_html(text: str) -> str:
    return markdown.markdown(text)


def txt_to_html(text: str) -> str:
    paras = [p for p in re.split(r"\n\s*\n", text.replace("\r\n", "\n")) if p.strip()]
    return "".join(
        "<p>" + "<br>".join(htmllib.escape(line) for line in p.strip().split("\n")) + "</p>"
        for p in paras
    )


IMPORTERS = {".md": md_to_html, ".txt": txt_to_html}


def derive_title(filename: str, text: str) -> str:
    m = re.search(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$", text, re.MULTILINE)
    if m and filename.lower().endswith(".md"):
        return m.group(1)[:200]
    name = PurePosixPath(filename.replace("\\", "/")).name
    stem = name.rsplit(".", 1)[0] if "." in name.lstrip(".") else name
    stem = "" if name.lower() in IMPORTERS else stem  # bare ".md" has no real name
    return stem[:200] if stem else "Untitled"
