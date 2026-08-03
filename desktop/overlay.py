from __future__ import annotations

import argparse
import bisect
import csv
import ctypes
import sys
import time
import tkinter as tk
from dataclasses import dataclass
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from app.srt import parse_srt

TRANSPARENT_COLOR = "#010203"


@dataclass(frozen=True, slots=True)
class OverlayCue:
    start: float
    end: float
    text: str


def timestamp_to_seconds(value: str) -> float:
    normalized = value.strip().replace(",", ".")
    hours, minutes, seconds = normalized.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def format_position(value: float) -> str:
    milliseconds = max(0, round(value * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


def load_csv_cues(path: Path, requested_column: str | None = None) -> tuple[list[OverlayCue], str]:
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        fieldnames = list(reader.fieldnames or [])
        column = requested_column or choose_text_column(fieldnames)
        if column not in fieldnames:
            raise ValueError(f"Column '{column}' was not found. Available: {', '.join(fieldnames)}")
        cues = [
            OverlayCue(
                start=timestamp_to_seconds(row["St"]),
                end=timestamp_to_seconds(row["Et"]),
                text=(row.get(column) or "").strip(),
            )
            for row in reader
            if (row.get(column) or "").strip()
        ]
    if not cues:
        raise ValueError("No timed subtitle rows were found in the CSV file.")
    return cues, column


def load_srt_cues(path: Path) -> tuple[list[OverlayCue], str]:
    document = parse_srt(path.read_bytes())
    cues: list[OverlayCue] = []
    for cue in document.cues:
        start, end = cue.timing.split("-->", maxsplit=1)
        cues.append(
            OverlayCue(
                start=timestamp_to_seconds(start),
                end=timestamp_to_seconds(end.split(maxsplit=1)[0]),
                text=cue.text,
            )
        )
    return cues, "SRT"


def load_subtitle_cues(
    path: Path,
    requested_column: str | None = None,
) -> tuple[list[OverlayCue], str]:
    suffix = path.suffix.casefold()
    if suffix == ".srt":
        return load_srt_cues(path)
    if suffix == ".csv":
        return load_csv_cues(path, requested_column)
    raise ValueError("Choose an SRT or timed subtitle CSV file.")


def choose_text_column(fieldnames: list[str]) -> str:
    for candidate in (
        "Subtitle_FA",
        "Subtitle_Persian",
        "Subtitle_KO",
        "Subtitle",
        "Text",
        "text",
    ):
        if candidate in fieldnames:
            return candidate
    subtitle_columns = [name for name in fieldnames if name.startswith("Subtitle_")]
    if subtitle_columns:
        return subtitle_columns[-1]
    raise ValueError("No Subtitle, Subtitle_FA, or Subtitle_* text column was found.")


class SubtitleOverlay:
    def __init__(self, root: tk.Tk, cues: list[OverlayCue], path: Path, column: str) -> None:
        self.root = root
        self.cues = cues
        self.starts = [cue.start for cue in cues]
        self.path = path
        self.column = column
        self.duration = max(cue.end for cue in cues)
        self.position = 0.0
        self.started_at = time.monotonic()
        self.playing = False
        self.current_text = ""
        self.preview_until = time.monotonic() + 5

        self._build_overlay()
        self._build_controller()
        self._bind_keys()
        self._tick()

    def _build_overlay(self) -> None:
        self.overlay = tk.Toplevel(self.root)
        self.overlay.overrideredirect(True)
        self.overlay.attributes("-topmost", True)
        self.overlay.configure(bg=TRANSPARENT_COLOR)
        try:
            self.overlay.wm_attributes("-transparentcolor", TRANSPARENT_COLOR)
        except tk.TclError:
            pass

        screen_width = self.overlay.winfo_screenwidth()
        screen_height = self.overlay.winfo_screenheight()
        height = 230
        self.overlay.geometry(f"{screen_width}x{height}+0+{screen_height - height - 50}")

        self.canvas = tk.Canvas(
            self.overlay,
            bg=TRANSPARENT_COLOR,
            highlightthickness=0,
            width=screen_width,
            height=height,
        )
        self.canvas.pack(fill="both", expand=True)
        center_x = screen_width // 2
        center_y = height // 2
        wrap_width = int(screen_width * 0.82)
        font = ("Tahoma", 32, "bold")
        self.outline_items = [
            self.canvas.create_text(
                center_x + offset_x,
                center_y + offset_y,
                text="",
                fill="#000000",
                font=font,
                width=wrap_width,
                justify="center",
            )
            for offset_x, offset_y in (
                (-3, -3),
                (0, -3),
                (3, -3),
                (-3, 0),
                (3, 0),
                (-3, 3),
                (0, 3),
                (3, 3),
            )
        ]
        self.text_item = self.canvas.create_text(
            center_x,
            center_y,
            text="",
            fill="#fffdf2",
            font=font,
            width=wrap_width,
            justify="center",
        )
        self.overlay.update_idletasks()
        self._apply_windows_overlay_style()
        self.root.after(300, self._apply_windows_overlay_style)

    def _build_controller(self) -> None:
        self.root.title("Subtitle Overlay Controller")
        self.root.geometry("460x245+30+30")
        self.root.attributes("-topmost", True)
        self.root.protocol("WM_DELETE_WINDOW", self.close)

        frame = ttk.Frame(self.root, padding=16)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text=self.path.name, font=("Segoe UI", 11, "bold")).pack(anchor="w")
        ttk.Label(frame, text=f"Text column: {self.column} · {len(self.cues)} cues").pack(
            anchor="w", pady=(2, 12)
        )

        self.time_label = ttk.Label(frame, text="00:00:00.000", font=("Consolas", 22, "bold"))
        self.time_label.pack(anchor="center")

        controls = ttk.Frame(frame)
        controls.pack(pady=10)
        ttk.Button(controls, text="−5s", command=lambda: self.seek(-5)).grid(
            row=0, column=0, padx=3
        )
        ttk.Button(controls, text="−0.5s", command=lambda: self.seek(-0.5)).grid(
            row=0, column=1, padx=3
        )
        self.play_button = ttk.Button(controls, text="▶ Play", command=self.toggle_play)
        self.play_button.grid(row=0, column=2, padx=8)
        ttk.Button(controls, text="+0.5s", command=lambda: self.seek(0.5)).grid(
            row=0, column=3, padx=3
        )
        ttk.Button(controls, text="+5s", command=lambda: self.seek(5)).grid(row=0, column=4, padx=3)

        ttk.Button(frame, text="Show test subtitle", command=self.show_preview).pack()

        set_time = ttk.Frame(frame)
        set_time.pack(fill="x", pady=(3, 0))
        ttk.Label(set_time, text="Jump to").pack(side="left")
        self.time_entry = ttk.Entry(set_time)
        self.time_entry.insert(0, "00:00:00,000")
        self.time_entry.pack(side="left", fill="x", expand=True, padx=8)
        ttk.Button(set_time, text="Set", command=self.set_from_entry).pack(side="right")

        ttk.Label(
            frame,
            text="Space: play/pause   ←/→: 5s   [ / ]: 0.5s   Esc: close",
            foreground="#666666",
        ).pack(anchor="center", pady=(12, 0))

    def _bind_keys(self) -> None:
        self.root.bind("<space>", lambda _event: self.toggle_play())
        self.root.bind("<Left>", lambda _event: self.seek(-5))
        self.root.bind("<Right>", lambda _event: self.seek(5))
        self.root.bind("[", lambda _event: self.seek(-0.5))
        self.root.bind("]", lambda _event: self.seek(0.5))
        self.root.bind("<Escape>", lambda _event: self.close())

    def _apply_windows_overlay_style(self) -> None:
        if sys.platform != "win32":
            return
        self.overlay.update_idletasks()
        hwnd = self.overlay.winfo_id()
        user32 = ctypes.windll.user32
        get_window_long = user32.GetWindowLongPtrW
        set_window_long = user32.SetWindowLongPtrW
        get_window_long.argtypes = [ctypes.c_void_p, ctypes.c_int]
        get_window_long.restype = ctypes.c_ssize_t
        set_window_long.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_ssize_t]
        set_window_long.restype = ctypes.c_ssize_t
        extended_style = get_window_long(hwnd, -20)
        layered = 0x80000
        click_through = 0x20
        tool_window = 0x80
        no_activate = 0x8000000
        set_window_long(
            hwnd,
            -20,
            extended_style | layered | click_through | tool_window | no_activate,
        )
        color_key = 0x00030201  # COLORREF byte order for #010203.
        user32.SetLayeredWindowAttributes.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint,
            ctypes.c_ubyte,
            ctypes.c_uint,
        ]
        user32.SetLayeredWindowAttributes(hwnd, color_key, 255, 0x1)
        user32.SetWindowPos(hwnd, ctypes.c_void_p(-1), 0, 0, 0, 0, 0x43)

    def show_preview(self) -> None:
        self.preview_until = time.monotonic() + 5
        self.current_text = ""

    def toggle_play(self) -> None:
        if self.playing:
            self.position = self.current_position()
            self.playing = False
            self.play_button.configure(text="▶ Play")
        else:
            self.started_at = time.monotonic() - self.position
            self.playing = True
            self.play_button.configure(text="⏸ Pause")

    def current_position(self) -> float:
        if not self.playing:
            return self.position
        return min(self.duration, max(0.0, time.monotonic() - self.started_at))

    def seek(self, seconds: float) -> None:
        self._set_position(self.current_position() + seconds)

    def _set_position(self, seconds: float) -> None:
        self.position = min(self.duration, max(0.0, seconds))
        self.started_at = time.monotonic() - self.position

    def set_from_entry(self) -> None:
        try:
            self._set_position(timestamp_to_seconds(self.time_entry.get()))
        except (TypeError, ValueError):
            messagebox.showerror("Invalid time", "Use HH:MM:SS,mmm, for example 00:05:23,500.")

    def _active_text(self, position: float) -> str:
        if not self.playing and time.monotonic() < self.preview_until:
            return self.cues[0].text
        index = bisect.bisect_right(self.starts, position) - 1
        if index >= 0 and self.cues[index].start <= position <= self.cues[index].end:
            return self.cues[index].text
        return ""

    def _tick(self) -> None:
        position = self.current_position()
        if self.playing and position >= self.duration:
            self.position = self.duration
            self.playing = False
            self.play_button.configure(text="▶ Play")
        subtitle_text = self._active_text(position)
        if subtitle_text != self.current_text:
            self.current_text = subtitle_text
            for outline_item in self.outline_items:
                self.canvas.itemconfigure(outline_item, text=subtitle_text)
            self.canvas.itemconfigure(self.text_item, text=subtitle_text)
        self.time_label.configure(text=format_position(position))
        self.root.after(30, self._tick)

    def close(self) -> None:
        self.overlay.destroy()
        self.root.destroy()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Display an SRT or timed CSV as an overlay.")
    parser.add_argument("file", nargs="?", type=Path)
    parser.add_argument("--column", default=None)
    return parser.parse_args()


def default_output_directory() -> Path:
    if getattr(sys, "frozen", False):
        project_output = Path(sys.executable).resolve().parent.parent / "output"
    else:
        project_output = Path(__file__).resolve().parents[1] / "output"
    return project_output


def main() -> None:
    args = parse_args()
    root = tk.Tk()
    root.withdraw()
    path = args.file
    if path is None:
        selected = filedialog.askopenfilename(
            title="Choose a translated subtitle file",
            initialdir=default_output_directory(),
            filetypes=(
                ("Subtitle files", "*.srt *.csv"),
                ("SRT subtitles", "*.srt"),
                ("Subtitle CSV", "*.csv"),
                ("All files", "*.*"),
            ),
        )
        if not selected:
            root.destroy()
            return
        path = Path(selected)

    try:
        cues, column = load_subtitle_cues(path, args.column)
    except (OSError, KeyError, TypeError, ValueError) as exc:
        messagebox.showerror("Could not open subtitles", str(exc))
        root.destroy()
        return

    root.deiconify()
    SubtitleOverlay(root, cues, path, column)
    root.mainloop()


if __name__ == "__main__":
    main()
