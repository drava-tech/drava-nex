"""Corpus loaders for the TRAVIS knowledge index.

Each loader yields ``Document`` records pulled from a different source:

* user docs / experience-center info  -> ``knowledge/*.md|*.txt|*.pdf``
* curated task knowledge (OKF bundle) -> ``knowledge_okf/**/*.md``
* visitor memory                      -> ``memory/long_term.json``

Curated task know-how (cube + LEGO) lives as an Open Knowledge Format (OKF) bundle: a
directory of markdown files, one "concept" per file, each with YAML frontmatter (``name``,
``type``, ``title``, ``source_label``) and a markdown body. This is the maintainable,
human- and agent-readable authoring layer; the underlying ``core/cube_tricks.json`` and
``lego/data/*.json`` are kept for the coaches' runtime use but are no longer indexed here.

A document is a coarse unit (one file, one cube stage, one memory entry); the
indexer is responsible for splitting long documents into embeddable chunks.
"""

import json
import sys
from dataclasses import dataclass
from pathlib import Path


def get_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent.parent


BASE_DIR = get_base_dir()
KNOWLEDGE_DIR = BASE_DIR / "knowledge"
OKF_DIR = BASE_DIR / "knowledge_okf"
CUBE_TRICKS = BASE_DIR / "core" / "cube_tricks.json"
LEGO_DATA = BASE_DIR / "lego" / "data"
MEMORY_PATH = BASE_DIR / "memory" / "long_term.json"


@dataclass(frozen=True)
class Document:
    doc_id: str  # stable id, used for de-dup / debugging
    title: str  # short human label
    text: str  # the content to embed/return
    source_label: str  # spoken-friendly source tag, e.g. "Experience Center"


def _read_pdf(path: Path) -> str:
    try:
        # pyrefly: ignore [missing-import]
        from pypdf import PdfReader  # optional dependency
    except Exception:
        print(f"[RAG] ⚠️ pypdf not installed; skipping {path.name}")
        return ""
    try:
        reader = PdfReader(str(path))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as e:
        print(f"[RAG] ⚠️ Could not read {path.name}: {e}")
        return ""


def load_user_docs() -> list[Document]:
    """Every .md/.txt/.pdf file under knowledge/ (experience-center info + any
    docs the operator drops in). Created lazily so a fresh checkout still works."""
    docs: list[Document] = []
    if not KNOWLEDGE_DIR.exists():
        return docs

    for path in sorted(KNOWLEDGE_DIR.rglob("*")):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix in (".md", ".txt"):
            try:
                text = path.read_text(encoding="utf-8")
            except Exception as e:
                print(f"[RAG] ⚠️ Could not read {path.name}: {e}")
                continue
        elif suffix == ".pdf":
            text = _read_pdf(path)
        else:
            continue

        if not text.strip():
            continue
        rel = path.relative_to(KNOWLEDGE_DIR).as_posix()
        docs.append(
            Document(
                doc_id=f"doc:{rel}",
                title=path.stem.replace("_", " ").title(),
                text=text,
                source_label="Experience Center",
            )
        )
    return docs


def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """Split an OKF markdown file into (frontmatter dict, body).

    Handles a leading ``---`` fenced block with simple ``key: value`` lines and
    ``[a, b]`` inline lists. Deliberately tiny so the bundle needs no YAML
    dependency; OKF concept files we author stay within this flat shape. A file
    with no frontmatter yields an empty dict and the whole text as the body.
    """
    if not text.startswith("---"):
        return {}, text.strip()

    lines = text.splitlines()
    # lines[0] is the opening fence; find the closing one.
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        return {}, text.strip()

    meta: dict[str, str] = {}
    for line in lines[1:end]:
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        elif value.startswith("[") and value.endswith("]"):
            value = ", ".join(
                v.strip().strip("\"'") for v in value[1:-1].split(",") if v.strip()
            )
        if key:
            meta[key] = value

    body = "\n".join(lines[end + 1 :]).strip()
    return meta, body


def load_okf_documents() -> list[Document]:
    """Load the curated task-knowledge OKF bundle under ``knowledge_okf/``.

    One markdown concept file -> one Document. Title and spoken source tag come
    from the frontmatter; the markdown body (cross-links included) is what we
    embed and return. Created lazily so a fresh checkout without a bundle still
    works.
    """
    docs: list[Document] = []
    if not OKF_DIR.exists():
        return docs

    for path in sorted(OKF_DIR.rglob("*.md")):
        if not path.is_file():
            continue
        try:
            raw = path.read_text(encoding="utf-8")
        except Exception as e:
            print(f"[RAG] ⚠️ Could not read {path.name}: {e}")
            continue

        meta, body = _parse_frontmatter(raw)
        if not body.strip():
            continue
        rel = path.relative_to(OKF_DIR).as_posix()
        title = (
            meta.get("title") or path.stem.replace("-", " ").replace("_", " ").title()
        )
        docs.append(
            Document(
                doc_id=f"okf:{rel}",
                title=title,
                text=body,
                source_label=meta.get("source_label", "Experience Center"),
            )
        )
    return docs


def _load_json(path: Path) -> dict | list | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[RAG] ⚠️ Could not parse {path.name}: {e}")
        return None


def load_cube_knowledge() -> list[Document]:
    """Flatten core/cube_tricks.json into readable, retrievable chunks."""
    data = _load_json(CUBE_TRICKS)
    if not isinstance(data, dict):
        return []

    docs: list[Document] = []
    label = "Cube Coach"

    notation = data.get("notation")
    if isinstance(notation, dict):
        lines = [f"{k}: {v}" for k, v in notation.items()]
        docs.append(
            Document(
                doc_id="cube:notation",
                title="Rubik's Cube notation",
                text="Rubik's cube move notation.\n" + "\n".join(lines),
                source_label=label,
            )
        )

    principles = data.get("first_principles")
    if isinstance(principles, list) and principles:
        docs.append(
            Document(
                doc_id="cube:first_principles",
                title="Cube first principles",
                text="Rubik's cube first principles.\n- "
                + "\n- ".join(map(str, principles)),
                source_label=label,
            )
        )

    for stage in data.get("stages", []) or []:
        if not isinstance(stage, dict):
            continue
        sid = stage.get("id", "stage")
        name = stage.get("name", sid)
        parts = [f"Cube stage: {name}."]
        for key in (
            "goal",
            "trick",
            "trick_left",
            "trick_right",
            "trick_corners",
            "trick_edges",
            "tip",
        ):
            if stage.get(key):
                parts.append(f"{key.replace('_', ' ').title()}: {stage[key]}")
        docs.append(
            Document(
                doc_id=f"cube:stage:{sid}",
                title=f"Cube stage — {name}",
                text="\n".join(parts),
                source_label=label,
            )
        )

    named = data.get("named_algorithms")
    if isinstance(named, dict) and named:
        lines = [f"{k.replace('_', ' ').title()}: {v}" for k, v in named.items()]
        docs.append(
            Document(
                doc_id="cube:named_algorithms",
                title="Named cube algorithms",
                text="Named Rubik's cube algorithms.\n" + "\n".join(lines),
                source_label=label,
            )
        )

    return docs


def load_lego_knowledge() -> list[Document]:
    """Flatten LEGO build recipes + piece catalog into retrievable chunks."""
    docs: list[Document] = []
    label = "LEGO Coach"

    recipes = _load_json(LEGO_DATA / "build_recipes.json")
    builds = recipes.get("builds") if isinstance(recipes, dict) else None
    if isinstance(builds, list):
        for build in builds:
            if not isinstance(build, dict):
                continue
            bid = build.get("id", "build")
            name = build.get("name", bid)
            parts = [f"LEGO build: {name}."]
            if build.get("description"):
                parts.append(str(build["description"]))
            steps = build.get("steps")
            if isinstance(steps, list):
                parts.append(f"It has {len(steps)} assembly steps.")
                for i, step in enumerate(steps, 1):
                    instr = (
                        step.get("instruction") or step.get("text")
                        if isinstance(step, dict)
                        else None
                    )
                    if instr:
                        parts.append(f"Step {i}: {instr}")
            docs.append(
                Document(
                    doc_id=f"lego:build:{bid}",
                    title=f"LEGO build — {name}",
                    text="\n".join(parts),
                    source_label=label,
                )
            )

    catalog = _load_json(LEGO_DATA / "piece_catalog.json")
    pieces = catalog.get("pieces") if isinstance(catalog, dict) else None
    if isinstance(pieces, list) and pieces:
        lines = []
        for p in pieces:
            if isinstance(p, dict) and p.get("name"):
                cat = p.get("category", "")
                lines.append(f"{p['name']} ({cat})" if cat else p["name"])
        if lines:
            docs.append(
                Document(
                    doc_id="lego:catalog",
                    title="LEGO piece catalog",
                    text="Known LEGO piece types: " + ", ".join(lines) + ".",
                    source_label=label,
                )
            )

    return docs


def load_memory_knowledge() -> list[Document]:
    """Turn long-term visitor memory entries into retrievable strings so TRAVIS
    can recall stored facts by meaning. Mirrors memory_manager's category layout."""
    data = _load_json(MEMORY_PATH)
    if not isinstance(data, dict):
        return []

    docs: list[Document] = []
    for category, items in data.items():
        if not isinstance(items, dict):
            continue
        for key, entry in items.items():
            value = entry.get("value") if isinstance(entry, dict) else entry
            if not value:
                continue
            label = key.replace("_", " ")
            docs.append(
                Document(
                    doc_id=f"memory:{category}:{key}",
                    title=f"{category}: {label}",
                    text=f"{category.title()} — {label}: {value}",
                    source_label="What I know about you",
                )
            )
    return docs


def load_all_documents() -> list[Document]:
    docs: list[Document] = []
    docs.extend(load_user_docs())
    # Curated cube/LEGO know-how now comes from the OKF bundle (load_okf_documents).
    # load_cube_knowledge / load_lego_knowledge are retained for reference and the
    # one-time migration but are intentionally not indexed, to avoid duplication.
    docs.extend(load_okf_documents())
    docs.extend(load_memory_knowledge())
    return docs


def source_paths() -> list[Path]:
    """Files/dirs whose contents define the corpus, for change detection."""
    paths = [MEMORY_PATH]
    if OKF_DIR.exists():
        paths.extend(sorted(p for p in OKF_DIR.rglob("*.md") if p.is_file()))
    if KNOWLEDGE_DIR.exists():
        paths.extend(sorted(p for p in KNOWLEDGE_DIR.rglob("*") if p.is_file()))
    return [p for p in paths if p.exists()]
