from __future__ import annotations

import csv
import io
import os
from pathlib import Path
from xml.sax.saxutils import escape

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A5
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer, TableStyle

from app.srt import TIMESTAMP_PATTERN, SubtitleCue

RTL_LANGUAGE_TERMS = ("arabic", "farsi", "persian", "hebrew", "urdu")
CJK_LANGUAGE_TERMS = ("korean", "japanese", "chinese")
_FONT_CACHE: dict[str, str] = {}


def format_study_time(timestamp: str) -> str:
    normalized = timestamp.strip().replace(",", ".")
    hours_text, minutes_text, seconds_text = normalized.split(":")
    hours = int(hours_text)
    minutes = int(minutes_text)
    seconds = int(float(seconds_text))
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def render_study_pdf_from_csv(
    data: bytes,
    *,
    source_language: str,
    target_language: str,
    title: str,
) -> bytes:
    text = data.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text, newline=""))
    fieldnames = list(reader.fieldnames or [])
    text_columns = [field for field in fieldnames if field not in {"Cue_ID", "St", "Et"}]
    if len(text_columns) < 2:
        raise ValueError("The translated CSV needs source and translated subtitle columns.")

    source_column, target_column = text_columns[:2]
    cues: list[SubtitleCue] = []
    translated_texts: list[str] = []
    for row_number, row in enumerate(reader, start=1):
        start = (row.get("St") or "").strip()
        end = (row.get("Et") or "").strip()
        source_text = (row.get(source_column) or "").strip()
        translated_text = (row.get(target_column) or "").strip()
        cues.append(
            SubtitleCue(
                identifier=(row.get("Cue_ID") or str(row_number)).strip(),
                timing=f"{start} --> {end}",
                text=source_text,
            )
        )
        translated_texts.append(translated_text)

    return render_study_pdf(
        cues,
        translated_texts,
        source_language=source_language,
        target_language=target_language,
        title=title,
    )


def render_study_pdf(
    cues: list[SubtitleCue],
    translated_texts: list[str],
    *,
    source_language: str,
    target_language: str,
    title: str,
) -> bytes:
    if len(cues) != len(translated_texts):
        raise ValueError("The translated cue count does not match the source cue count.")

    source_font = _font_for_language(source_language)
    target_font = _font_for_language(target_language)
    source_style = _body_style("StudySource", source_font, source_language)
    target_style = _body_style("StudyTarget", target_font, target_language)
    time_style = ParagraphStyle(
        "StudyTime",
        fontName="Helvetica",
        fontSize=9.5,
        leading=12,
        textColor=colors.HexColor("#596579"),
        alignment=TA_LEFT,
    )
    header_style = ParagraphStyle(
        "StudyHeader",
        fontName="Helvetica-Bold",
        fontSize=9.5,
        leading=12,
        textColor=colors.white,
        alignment=TA_LEFT,
    )
    title_style = ParagraphStyle(
        "StudyTitle",
        fontName=source_font,
        fontSize=16,
        leading=20,
        textColor=colors.HexColor("#172033"),
        spaceAfter=4,
    )
    meta_style = ParagraphStyle(
        "StudyMeta",
        fontName="Helvetica",
        fontSize=9.5,
        leading=13,
        textColor=colors.HexColor("#667085"),
        spaceAfter=10,
    )

    rows: list[list[object]] = [
        [
            Paragraph("Time", header_style),
            Paragraph(escape(source_language), header_style),
            Paragraph(escape(target_language), header_style),
        ]
    ]
    for cue, translated in zip(cues, translated_texts, strict=True):
        match = TIMESTAMP_PATTERN.fullmatch(cue.timing)
        if not match:
            raise ValueError(f"Cue {cue.identifier} has an invalid timestamp line.")
        rows.append(
            [
                Paragraph(format_study_time(match.group("start")), time_style),
                Paragraph(_paragraph_text(cue.text, source_language), source_style),
                Paragraph(_paragraph_text(translated.strip(), target_language), target_style),
            ]
        )

    output = io.BytesIO()
    document = SimpleDocTemplate(
        output,
        pagesize=A5,
        rightMargin=8 * mm,
        leftMargin=8 * mm,
        topMargin=9 * mm,
        bottomMargin=9 * mm,
        title=title,
        author="Subtitle Project",
    )
    available_width = A5[0] - document.leftMargin - document.rightMargin
    time_width = 0.13 * available_width
    text_width = (available_width - time_width) / 2
    table = LongTable(
        rows,
        colWidths=[time_width, text_width, text_width],
        repeatRows=1,
        hAlign="LEFT",
    )
    style_commands: list[tuple] = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#26344D")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, 0), 7),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
        ("TOPPADDING", (0, 1), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#D7DDE6")),
        ("LINEBELOW", (0, 0), (-1, 0), 0.7, colors.HexColor("#26344D")),
    ]
    for row_index in range(2, len(rows), 2):
        style_commands.append(
            ("BACKGROUND", (0, row_index), (-1, row_index), colors.HexColor("#F7F9FC"))
        )
    table.setStyle(TableStyle(style_commands))

    story = [
        Paragraph(_paragraph_text(title, source_language), title_style),
        Paragraph(
            f"{escape(source_language)} -> {escape(target_language)} | "
            f"{len(cues)} subtitle lines | simplified start times",
            meta_style,
        ),
        Spacer(1, 2 * mm),
        table,
    ]
    document.build(story)
    return output.getvalue()


def _body_style(name: str, font_name: str, language: str) -> ParagraphStyle:
    normalized = language.casefold()
    is_rtl = any(term in normalized for term in RTL_LANGUAGE_TERMS)
    is_cjk = any(term in normalized for term in CJK_LANGUAGE_TERMS)
    return ParagraphStyle(
        name,
        fontName=font_name,
        fontSize=12,
        leading=17,
        textColor=colors.HexColor("#1E293B"),
        alignment=TA_RIGHT if is_rtl else TA_LEFT,
        wordWrap="CJK" if is_cjk else None,
        splitLongWords=1,
    )


def _paragraph_text(value: str, language: str) -> str:
    is_rtl = any(term in language.casefold() for term in RTL_LANGUAGE_TERMS)
    rendered_lines: list[str] = []
    for line in value.strip().splitlines():
        display_line = line
        if is_rtl:
            display_line = get_display(arabic_reshaper.reshape(line))
        rendered_lines.append(escape(display_line))
    return "<br/>".join(rendered_lines)


def _font_for_language(language: str) -> str:
    key = language.casefold()
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]

    normalized = language.casefold()
    if "korean" in normalized:
        candidates = (
            "malgun.ttf",
            "NanumGothic.ttf",
            "NanumBarunGothic.ttf",
            "UnDotum.ttf",
            "AppleSDGothicNeo.ttc",
        )
        cid_fallback = "HYSMyeongJo-Medium"
    elif "japanese" in normalized:
        candidates = (
            "YuGothM.ttc",
            "meiryo.ttc",
            "NotoSansJP-Regular.ttf",
            "Hiragino Sans W3.ttc",
        )
        cid_fallback = "HeiseiMin-W3"
    elif "chinese" in normalized:
        candidates = (
            "msyh.ttc",
            "msjh.ttc",
            "simsun.ttc",
            "NotoSansSC-Regular.ttf",
            "PingFang.ttc",
        )
        cid_fallback = "STSong-Light"
    elif any(term in normalized for term in RTL_LANGUAGE_TERMS):
        candidates = (
            "NotoSansArabic-Regular.ttf",
            "arial.ttf",
            "tahoma.ttf",
            "segoeui.ttf",
            "DejaVuSans.ttf",
        )
        cid_fallback = None
    else:
        candidates = ("DejaVuSans.ttf", "arial.ttf", "LiberationSans-Regular.ttf")
        cid_fallback = None

    for candidate in candidates:
        path = _find_font(candidate)
        if path is None:
            continue
        font_name = f"StudyFont{len(_FONT_CACHE) + 1}"
        try:
            pdfmetrics.registerFont(TTFont(font_name, str(path)))
        except Exception:
            continue
        _FONT_CACHE[key] = font_name
        return font_name

    if cid_fallback:
        try:
            pdfmetrics.getFont(cid_fallback)
        except KeyError:
            pdfmetrics.registerFont(UnicodeCIDFont(cid_fallback))
        _FONT_CACHE[key] = cid_fallback
        return cid_fallback

    _FONT_CACHE[key] = "Helvetica"
    return "Helvetica"


def _find_font(filename: str) -> Path | None:
    direct_candidates = [
        Path(filename),
        Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / filename,
        Path("/usr/share/fonts/truetype/noto") / filename,
        Path("/usr/share/fonts/truetype/nanum") / filename,
        Path("/usr/share/fonts/truetype/unfonts-core") / filename,
        Path("/usr/share/fonts/truetype/dejavu") / filename,
        Path("/usr/share/fonts/truetype/liberation2") / filename,
        Path("/System/Library/Fonts") / filename,
        Path("/System/Library/Fonts/Supplemental") / filename,
        Path("/Library/Fonts") / filename,
    ]
    for candidate in direct_candidates:
        if candidate.is_file():
            return candidate
    return None
