from __future__ import annotations

import html
import re

from app.srt import TIMESTAMP_PATTERN, SubtitleCue

RTL_LANGUAGE_TERMS = ("arabic", "farsi", "persian", "hebrew", "urdu")


def format_study_time(timestamp: str) -> str:
    normalized = timestamp.strip().replace(",", ".")
    hours_text, minutes_text, seconds_text = normalized.split(":")
    hours = int(hours_text)
    minutes = int(minutes_text)
    seconds = int(float(seconds_text))
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def render_study_guide(
    cues: list[SubtitleCue],
    translated_texts: list[str],
    *,
    source_language: str,
    target_language: str,
    title: str,
) -> bytes:
    if len(cues) != len(translated_texts):
        raise ValueError("The translated cue count does not match the source cue count.")

    source_direction = _language_direction(source_language)
    target_direction = _language_direction(target_language)
    rows: list[str] = []
    for cue, translated in zip(cues, translated_texts, strict=True):
        match = TIMESTAMP_PATTERN.fullmatch(cue.timing)
        if not match:
            raise ValueError(f"Cue {cue.identifier} has an invalid timestamp line.")
        study_time = format_study_time(match.group("start"))
        source_text = _render_multiline_text(cue.text)
        target_text = _render_multiline_text(translated.strip())
        rows.append(
            f"""
            <article class="cue">
              <div class="time">{html.escape(study_time)}</div>
              <div class="texts">
                <section class="language-block" dir="{source_direction}">
                  <div class="language-label">{html.escape(source_language)}</div>
                  <div class="subtitle-text">{source_text}</div>
                </section>
                <section class="language-block translation" dir="{target_direction}">
                  <div class="language-label">{html.escape(target_language)}</div>
                  <div class="subtitle-text">{target_text}</div>
                </section>
              </div>
            </article>
            """
        )

    document = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(title)}</title>
  <style>
    :root {{ color-scheme: light; }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: #f4f6f8;
      color: #18202a;
      font-family: Inter, "Segoe UI", Arial, sans-serif;
      line-height: 1.55;
    }}
    .page {{
      width: min(920px, calc(100% - 32px));
      margin: 32px auto;
      background: white;
      border: 1px solid #e5e9ef;
      border-radius: 16px;
      box-shadow: 0 10px 32px rgba(25, 35, 50, 0.08);
      overflow: hidden;
    }}
    header {{
      padding: 36px 42px 30px;
      border-bottom: 1px solid #e7ebf0;
    }}
    h1 {{ margin: 0 0 8px; font-size: 26px; line-height: 1.25; }}
    .meta {{ color: #667085; font-size: 14px; }}
    main {{ padding: 8px 42px 28px; }}
    .cue {{
      display: grid;
      grid-template-columns: 64px 1fr;
      gap: 18px;
      padding: 24px 0;
      border-bottom: 1px solid #edf0f3;
      break-inside: avoid;
      page-break-inside: avoid;
    }}
    .cue:last-child {{ border-bottom: 0; }}
    .time {{
      color: #667085;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
      padding-top: 3px;
    }}
    .texts {{ display: grid; gap: 15px; min-width: 0; }}
    .language-block {{ min-width: 0; }}
    .translation {{
      padding-top: 14px;
      border-top: 1px dashed #d8dde5;
    }}
    .language-label {{
      margin-bottom: 5px;
      color: #7b8493;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
    }}
    .subtitle-text {{
      font-size: 17px;
      overflow-wrap: anywhere;
    }}
    @media (max-width: 640px) {{
      .page {{ width: 100%; margin: 0; border: 0; border-radius: 0; box-shadow: none; }}
      header, main {{ padding-left: 22px; padding-right: 22px; }}
      .cue {{ grid-template-columns: 52px 1fr; gap: 12px; }}
    }}
    @media print {{
      @page {{ size: A4; margin: 14mm; }}
      body {{ background: white; }}
      .page {{
        width: auto;
        margin: 0;
        border: 0;
        border-radius: 0;
        box-shadow: none;
      }}
      header {{ padding: 0 0 18px; }}
      main {{ padding: 0; }}
      .cue {{ padding: 16px 0; }}
    }}
  </style>
</head>
<body>
  <div class="page">
    <header>
      <h1>{html.escape(title)}</h1>
      <div class="meta">{html.escape(source_language)} → {html.escape(target_language)} · {len(cues)} subtitle lines</div>
    </header>
    <main>
      {''.join(rows)}
    </main>
  </div>
</body>
</html>
"""
    return document.encode("utf-8")


def _render_multiline_text(value: str) -> str:
    escaped = html.escape(value.strip())
    return re.sub(r"\r?\n", "<br>", escaped)


def _language_direction(language: str) -> str:
    normalized = language.casefold()
    return "rtl" if any(term in normalized for term in RTL_LANGUAGE_TERMS) else "ltr"
