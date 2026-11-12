"""Every byte of stored HTML goes through here (nh3 allowlist, no attrs)."""
import nh3

ALLOWED_TAGS = {"p", "h1", "h2", "strong", "em", "u", "ul", "ol", "li", "br"}


def clean_html(html: str) -> str:
    # attributes={} kills on* handlers, style, href, all of it; script content is dropped too
    return nh3.clean(html, tags=ALLOWED_TAGS, attributes={})
