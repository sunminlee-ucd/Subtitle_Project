from __future__ import annotations

import asyncio
import os
import queue
import re
import sys
import threading
import tkinter as tk
from dataclasses import dataclass
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from app.config import Settings
from app.episode_pipeline import (
    PipelineProgress,
    TranslationPackage,
    analyze_combined_csv,
    clean_cues,
    translate_combined_csv_to_srt,
    write_translation_package,
)
from app.translator import OpenAITranslator, estimate_translation_cost
from app.ttml import parse_ttml

LANGUAGES = (
    "Persian (Farsi)",
    "English",
    "Korean",
    "Arabic",
    "Chinese (Simplified)",
    "French",
    "German",
    "Japanese",
    "Spanish",
)
PRIVATE_API_KEY_FILENAME = "API key for openAI.txt"
TTML_EXTENSIONS = {".xml", ".ttml"}
TTML_LANGUAGE_NAMES = {
    "ar": "Arabic",
    "de": "German",
    "en": "English",
    "es": "Spanish",
    "fa": "Persian (Farsi)",
    "fr": "French",
    "ja": "Japanese",
    "ko": "Korean",
    "zh": "Chinese (Simplified)",
}
EPISODE_FILENAME_PATTERN = re.compile(
    r"(?:^|[\s._-])(?:S\d+[\s._:-]*)?E(?:PISODE)?[\s._-]*(\d+)",
    re.IGNORECASE,
)


def episode_number_from_filename(filename: str, fallback: int) -> int:
    match = EPISODE_FILENAME_PATTERN.search(Path(filename).stem)
    return int(match.group(1)) if match else fallback


def private_api_key_path() -> Path:
    if getattr(sys, "frozen", False):
        project_directory = Path(sys.executable).resolve().parent.parent
    else:
        project_directory = Path(__file__).resolve().parents[1]
    return project_directory / PRIVATE_API_KEY_FILENAME


def load_private_api_key(path: Path | None = None) -> str:
    key_path = path or private_api_key_path()
    try:
        content = key_path.read_text(encoding="utf-8-sig")
    except OSError as error:
        raise RuntimeError(f"Could not load the private API key file: {key_path}") from error

    nonempty_lines = [line.strip() for line in content.splitlines() if line.strip()]
    if not nonempty_lines:
        raise RuntimeError(f"The private API key file is empty: {key_path}")
    key = nonempty_lines[0]
    if key.startswith("OPENAI_API_KEY="):
        key = key.split("=", maxsplit=1)[1].strip().strip("\"'")
    if not key.startswith("sk-"):
        raise RuntimeError(
            f"The private API key file does not contain a valid OpenAI key: {key_path}"
        )
    return key


@dataclass(frozen=True, slots=True)
class PreparedSubtitleInput:
    input_data: bytes
    source_file: str
    source_column: str | None
    starting_episode: int
    final_segment_complete: bool


class TranslationRequest:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        review_model: str,
        inputs: tuple[PreparedSubtitleInput, ...],
        output_directory: Path,
        target_language: str,
        source_language: str,
        reset_threshold_seconds: float,
        include_incomplete_final: bool,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.review_model = review_model
        self.inputs = inputs
        self.output_directory = output_directory
        self.target_language = target_language
        self.source_language = source_language
        self.reset_threshold_seconds = reset_threshold_seconds
        self.include_incomplete_final = include_incomplete_final


class SubtitleProcessorApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("Subtitle Episode Splitter & Translator")
        self.root.geometry("780x720")
        self.root.minsize(700, 620)
        self.input_path = tk.StringVar()
        self.output_directory = tk.StringVar(value=str(default_output_directory()))
        self.source_language = tk.StringVar(value="Korean")
        self.target_language = tk.StringVar(value="Persian (Farsi)")
        self.source_column = tk.StringVar(value="Auto")
        self.start_episode = tk.IntVar(value=1)
        self.reset_minutes = tk.DoubleVar(value=10.0)
        self.include_incomplete_final = tk.BooleanVar(value=False)
        self.api_key = tk.StringVar(value=os.getenv("OPENAI_API_KEY", ""))
        self.model = tk.StringVar(value=os.getenv("OPENAI_MODEL", "gpt-5-mini"))
        self.review_model = tk.StringVar(
            value=os.getenv("OPENAI_REVIEW_MODEL", "gpt-5.6-terra")
        )
        self.max_estimated_cost = tk.DoubleVar(value=0.25)
        self.progress_value = tk.DoubleVar(value=0.0)
        self.progress_status = tk.StringVar(value="Ready")
        self.progress_events: queue.Queue[PipelineProgress] = queue.Queue()
        self.analysis = []
        self.selected_input_paths: list[Path] = []
        self.prepared_inputs: list[PreparedSubtitleInput] = []
        self.normalized_input_data = b""
        self.normalized_source_file = ""
        self.final_segment_complete = False
        self._build()
        self.root.after(100, self._drain_progress_queue)

    def _build(self) -> None:
        frame = ttk.Frame(self.root, padding=18)
        frame.pack(fill="both", expand=True)
        ttk.Label(
            frame,
            text="Convert Netflix TTML/XML or CSV and translate it to SRT",
            font=("Segoe UI", 15, "bold"),
        ).grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 16))

        self._path_row(frame, 1, "Netflix XML or subtitle CSV", self.input_path, self.choose_input)
        self._path_row(frame, 2, "Output folder", self.output_directory, self.choose_output)

        ttk.Label(frame, text="Starting episode").grid(row=3, column=0, sticky="w", pady=6)
        ttk.Spinbox(frame, from_=1, to=999, textvariable=self.start_episode, width=12).grid(
            row=3, column=1, sticky="w", pady=6
        )
        ttk.Label(frame, text="Reset threshold (minutes)").grid(row=4, column=0, sticky="w", pady=6)
        ttk.Spinbox(
            frame,
            from_=1,
            to=120,
            increment=1,
            textvariable=self.reset_minutes,
            width=12,
        ).grid(row=4, column=1, sticky="w", pady=6)

        ttk.Label(frame, text="Source column").grid(row=5, column=0, sticky="w", pady=6)
        ttk.Combobox(
            frame,
            textvariable=self.source_column,
            values=("Auto", "Subtitle", "Subtitle_KO", "Text"),
            width=28,
        ).grid(row=5, column=1, sticky="ew", pady=6)
        ttk.Label(frame, text="Source language").grid(row=6, column=0, sticky="w", pady=6)
        ttk.Combobox(
            frame,
            textvariable=self.source_language,
            values=LANGUAGES,
            width=28,
        ).grid(row=6, column=1, sticky="ew", pady=6)
        ttk.Label(frame, text="Target language").grid(row=7, column=0, sticky="w", pady=6)
        ttk.Combobox(
            frame,
            textvariable=self.target_language,
            values=LANGUAGES,
            width=28,
        ).grid(row=7, column=1, sticky="ew", pady=6)
        ttk.Label(frame, text="API key override (optional)").grid(
            row=8, column=0, sticky="w", pady=6
        )
        ttk.Entry(frame, textvariable=self.api_key, show="*", width=38).grid(
            row=8, column=1, sticky="ew", pady=6
        )
        ttk.Label(frame, text="Model (cost-first default)").grid(
            row=9, column=0, sticky="w", pady=6
        )
        ttk.Combobox(
            frame,
            textvariable=self.model,
            values=("gpt-5-mini", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6"),
            width=28,
        ).grid(row=9, column=1, sticky="ew", pady=6)
        ttk.Label(frame, text="Escalation model (difficult cues only)").grid(
            row=10, column=0, sticky="w", pady=6
        )
        ttk.Combobox(
            frame,
            textvariable=self.review_model,
            values=("gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6", "gpt-5.6-sol"),
            width=28,
        ).grid(row=10, column=1, sticky="ew", pady=6)
        ttk.Label(frame, text="Estimated cost guard (USD)").grid(
            row=11, column=0, sticky="w", pady=6
        )
        ttk.Spinbox(
            frame,
            from_=0.01,
            to=100,
            increment=0.05,
            textvariable=self.max_estimated_cost,
            width=12,
        ).grid(row=11, column=1, sticky="w", pady=6)
        ttk.Checkbutton(
            frame,
            text="Translate final segment even when its ending is unconfirmed",
            variable=self.include_incomplete_final,
        ).grid(row=12, column=1, columnspan=2, sticky="w", pady=6)

        actions = ttk.Frame(frame)
        actions.grid(row=13, column=0, columnspan=3, sticky="w", pady=(14, 10))
        self.analyze_button = ttk.Button(actions, text="1. Analyze episodes", command=self.analyze)
        self.analyze_button.pack(side="left", padx=(0, 8))
        self.translate_button = ttk.Button(
            actions,
            text="2. Translate to CSV + SRT (API charges apply)",
            command=self.translate,
        )
        self.translate_button.pack(side="left")

        ttk.Label(frame, textvariable=self.progress_status).grid(
            row=14, column=0, columnspan=3, sticky="w", pady=(4, 4)
        )
        ttk.Progressbar(
            frame,
            variable=self.progress_value,
            maximum=100,
            mode="determinate",
        ).grid(row=15, column=0, columnspan=3, sticky="ew", pady=(0, 8))
        ttk.Label(frame, text="Analysis, progress, and difficult-cue handling").grid(
            row=16, column=0, columnspan=3, sticky="w", pady=(4, 4)
        )
        self.log = tk.Text(frame, height=16, wrap="word", font=("Consolas", 10))
        self.log.grid(row=17, column=0, columnspan=3, sticky="nsew")
        frame.columnconfigure(1, weight=1)
        frame.rowconfigure(17, weight=1)

    def _path_row(
        self,
        frame: ttk.Frame,
        row: int,
        label: str,
        variable: tk.StringVar,
        command: object,
    ) -> None:
        ttk.Label(frame, text=label).grid(row=row, column=0, sticky="w", pady=6)
        ttk.Entry(frame, textvariable=variable).grid(row=row, column=1, sticky="ew", pady=6)
        ttk.Button(frame, text="Browse", command=command).grid(
            row=row, column=2, sticky="e", padx=(8, 0), pady=6
        )

    def choose_input(self) -> None:
        selected = filedialog.askopenfilenames(
            title="Choose one or more Netflix TTML/XML or timed subtitle CSV files",
            filetypes=(
                ("Netflix TTML/XML or CSV", "*.xml *.ttml *.csv"),
                ("Netflix TTML/XML", "*.xml *.ttml"),
                ("Timed subtitle CSV", "*.csv"),
            ),
        )
        if selected:
            self.selected_input_paths = [Path(value) for value in selected]
            if len(selected) == 1:
                self.input_path.set(selected[0])
            else:
                self.input_path.set(
                    f"{len(selected)} files selected: "
                    + "; ".join(Path(value).name for value in selected)
                )

    def choose_output(self) -> None:
        selected = filedialog.askdirectory(
            title="Choose output folder",
            initialdir=self.output_directory.get(),
        )
        if selected:
            self.output_directory.set(selected)

    def selected_source_column(self) -> str | None:
        value = self.source_column.get().strip()
        return None if not value or value.casefold() == "auto" else value

    def analyze(self) -> bool:
        try:
            paths = list(self.selected_input_paths)
            if not paths:
                paths = [
                    Path(value.strip().strip('"'))
                    for value in self.input_path.get().split(";")
                    if value.strip()
                ]
            if not paths or any(not path.is_file() for path in paths):
                raise ValueError("Choose one or more existing Netflix XML/TTML or CSV files.")
            output_directory = Path(self.output_directory.get())
            output_directory.mkdir(parents=True, exist_ok=True)
            self.prepared_inputs = []
            self.analysis = []
            generated_csv_paths: list[Path] = []
            next_episode = self.start_episode.get()
            for path in paths:
                raw_data = path.read_bytes()
                source_column = self.selected_source_column()
                final_segment_complete = path.suffix.casefold() in TTML_EXTENSIONS
                normalized_data = raw_data
                if final_segment_complete:
                    document = parse_ttml(raw_data)
                    normalized_data = document.render_csv()
                    source_column = document.source_column
                    self.source_column.set(source_column)
                    detected_language = TTML_LANGUAGE_NAMES.get(
                        document.language.casefold().split("-", maxsplit=1)[0]
                    )
                    if detected_language:
                        self.source_language.set(detected_language)
                    generated_csv_path = output_directory / f"{path.stem}.source.csv"
                    generated_csv_path.write_bytes(normalized_data)
                    generated_csv_paths.append(generated_csv_path)
                input_starting_episode = (
                    episode_number_from_filename(path.name, next_episode)
                    if final_segment_complete
                    else next_episode
                )
                segments = analyze_combined_csv(
                    normalized_data,
                    source_column=source_column,
                    starting_episode=input_starting_episode,
                    reset_threshold_seconds=self.reset_minutes.get() * 60,
                    final_segment_complete=final_segment_complete,
                )
                self.prepared_inputs.append(
                    PreparedSubtitleInput(
                        input_data=normalized_data,
                        source_file=path.name,
                        source_column=source_column,
                        starting_episode=input_starting_episode,
                        final_segment_complete=final_segment_complete,
                    )
                )
                self.analysis.extend(segments)
                next_episode = max(next_episode, input_starting_episode + len(segments))
            self.final_segment_complete = all(
                item.final_segment_complete for item in self.prepared_inputs
            )
        except (OSError, RuntimeError, TypeError, ValueError, tk.TclError) as exc:
            messagebox.showerror("Could not analyze subtitles", str(exc))
            return False

        self.log.delete("1.0", "end")
        if generated_csv_paths:
            self._append_log(
                f"Parsed {len(generated_csv_paths)} Netflix TTML/XML file(s). Source CSVs:\n"
            )
            for generated_csv_path in generated_csv_paths:
                self._append_log(f"  {generated_csv_path}\n")
            self._append_log("\n")
        for segment in self.analysis:
            item = segment.analysis
            partial = " / partial start" if item.partial_start else ""
            action = (
                "translate"
                if item.completion_status != "unknown_end_of_input"
                or self.include_incomplete_final.get()
                else "SKIP incomplete final segment"
            )
            self._append_log(
                f"Episode {item.episode_number}: rows {item.source_row_start}-"
                f"{item.source_row_end}, {item.cue_count} cues, "
                f"{item.first_start} -> {item.last_end}, "
                f"{item.completion_status}{partial} / {action}\n"
            )
        if self.final_segment_complete:
            self._append_log(
                "\nNetflix TTML is treated as a complete source track and will be translated.\n"
            )
        else:
            self._append_log(
                "\nThe unconfirmed final segment is skipped by default. "
                "Enable the checkbox only when you know it is complete.\n"
            )
        return True

    def translate(self) -> None:
        if not self.analyze():
            return
        settings = Settings.from_environment()
        model = self.model.get().strip() or settings.openai_model
        review_model = self.review_model.get().strip() or settings.openai_review_model
        cleaned_episodes = [
            clean_cues(segment.cues)
            for segment in self.analysis
            if segment.analysis.completion_status != "unknown_end_of_input"
            or self.include_incomplete_final.get()
        ]
        cue_count = sum(len(cues) for cues in cleaned_episodes)
        if cue_count == 0:
            messagebox.showinfo(
                "Nothing to translate",
                "Only an unconfirmed final segment was found, so no translation will run.",
            )
            return
        estimates = [
            estimate_translation_cost(
                cues,
                model=model,
                review_model=review_model,
                batch_character_limit=settings.translation_batch_characters,
            )
            for cues in cleaned_episodes
        ]
        estimated_input = sum(estimate.estimated_input_tokens for estimate in estimates)
        estimated_output = sum(estimate.estimated_output_tokens for estimate in estimates)
        maximum_requests = sum(estimate.maximum_request_count for estimate in estimates)
        maximum_review_cues = sum(estimate.maximum_review_cues for estimate in estimates)
        estimated_cost = (
            sum(estimate.estimated_cost_usd or 0 for estimate in estimates)
            if all(estimate.estimated_cost_usd is not None for estimate in estimates)
            else None
        )
        try:
            cost_guard = self.max_estimated_cost.get()
        except tk.TclError:
            messagebox.showerror("Invalid cost guard", "Enter a valid positive USD amount.")
            return
        if cost_guard <= 0:
            messagebox.showerror("Invalid cost guard", "The cost guard must be greater than zero.")
            return
        if estimated_cost is not None and estimated_cost > cost_guard:
            messagebox.showerror(
                "Estimated cost exceeds guard",
                f"Estimated standard-rate cost: ${estimated_cost:.4f}\n"
                f"Configured guard: ${cost_guard:.2f}\n\n"
                "Reduce the input, keep gpt-5-mini selected, or deliberately raise the guard.",
            )
            return
        cost_line = (
            f"Approximate standard-rate cost: ${estimated_cost:.4f}"
            if estimated_cost is not None
            else "Approximate cost unavailable for this custom model"
        )
        if not messagebox.askyesno(
            "OpenAI API charge",
            f"Translate {cue_count} captured cues into {self.target_language.get()}?\n\n"
            f"Primary model: {model}\n"
            f"Escalation model: {review_model}\n"
            f"Maximum API requests: {maximum_requests}\n"
            f"Estimated tokens: {estimated_input:,} input / {estimated_output:,} output\n"
            f"Targeted review cap: {maximum_review_cues} cues\n"
            f"{cost_line}\n\n"
            "This is a conservative estimate, not a billing guarantee. Eligible data-sharing "
            "credits may reduce the actual charge.",
        ):
            return
        key = self.api_key.get().strip()
        if not key:
            try:
                key = load_private_api_key()
            except RuntimeError as error:
                messagebox.showerror("API key required", str(error))
                return
        request = TranslationRequest(
            api_key=key,
            model=model,
            review_model=review_model,
            inputs=tuple(self.prepared_inputs),
            output_directory=Path(self.output_directory.get()),
            target_language=self.target_language.get().strip(),
            source_language=self.source_language.get().strip(),
            reset_threshold_seconds=self.reset_minutes.get() * 60,
            include_incomplete_final=self.include_incomplete_final.get(),
        )
        self.progress_value.set(0.0)
        self.progress_status.set("Starting cost-optimized quality translation...")
        self._append_log(
            f"\nCost-optimized routing started: {model} -> {review_model} "
            f"for difficult cues only. {cost_line}.\n"
        )
        self._set_busy(True)
        threading.Thread(target=self._translation_worker, args=(request,), daemon=True).start()

    def _translation_worker(self, request: TranslationRequest) -> None:
        try:
            settings = Settings.from_environment()
            translator = OpenAITranslator(
                api_key=request.api_key,
                model=request.model or settings.openai_model,
                review_model=request.review_model or settings.openai_review_model,
                batch_character_limit=settings.translation_batch_characters,
                max_concurrent_requests=settings.translation_concurrency,
            )
            async def translate_all_inputs() -> tuple[list[TranslationPackage], list[Path]]:
                packages: list[TranslationPackage] = []
                written: list[Path] = []
                input_count = len(request.inputs)
                for input_index, prepared in enumerate(request.inputs):
                    def forward_progress(
                        event: PipelineProgress,
                        *,
                        current_index: int = input_index,
                        filename: str = prepared.source_file,
                    ) -> None:
                        self.progress_events.put(
                            PipelineProgress(
                                episode_number=event.episode_number,
                                stage=event.stage,
                                message=f"{filename}: {event.message}",
                                overall_percent=(
                                    current_index + event.overall_percent / 100
                                )
                                / input_count
                                * 100,
                                completed=event.completed,
                                total=event.total,
                            )
                        )

                    package = await translate_combined_csv_to_srt(
                        prepared.input_data,
                        source_file=prepared.source_file,
                        translator=translator,
                        target_language=request.target_language,
                        source_language=request.source_language,
                        source_column=prepared.source_column,
                        starting_episode=prepared.starting_episode,
                        reset_threshold_seconds=request.reset_threshold_seconds,
                        include_incomplete_final=request.include_incomplete_final,
                        final_segment_complete=prepared.final_segment_complete,
                        progress_callback=forward_progress,
                        checkpoint_directory=(
                            request.output_directory / ".translation_checkpoints"
                        ),
                    )
                    packages.append(package)
                    summary_filename = (
                        f"{Path(prepared.source_file).stem}.translation_summary.json"
                        if input_count > 1
                        else "episode_translation_summary.json"
                    )
                    written.extend(
                        write_translation_package(
                            package,
                            request.output_directory,
                            summary_filename=summary_filename,
                        )
                    )
                return packages, written

            packages, written = asyncio.run(translate_all_inputs())
        except Exception as error:  # Tkinter needs errors returned to its main thread.
            self.root.after(0, self._translation_failed, str(error))
            return
        srt_count = sum(len(package.episodes) for package in packages)
        issue_count = sum(
            episode.issue_count
            for package in packages
            for episode in package.episodes
        )
        self.root.after(
            0,
            lambda: self._translation_complete(written, srt_count, issue_count),
        )

    def _translation_failed(self, message: str) -> None:
        self._set_busy(False)
        self.progress_status.set("Translation failed")
        messagebox.showerror("Translation failed", message)

    def _translation_complete(
        self,
        written: list[Path],
        srt_count: int,
        issue_count: int,
    ) -> None:
        self._set_busy(False)
        self.progress_value.set(100.0)
        self.progress_status.set(f"Complete: {srt_count} SRT file(s), {issue_count} cue(s) flagged")
        self._append_log("\nTranslation complete:\n")
        for path in written:
            self._append_log(f"  {path}\n")
        messagebox.showinfo(
            "Translation complete",
            f"Saved {srt_count} completed-episode SRT file(s).\n"
            f"Flagged {issue_count} cue(s) in quality reports.\n\n"
            f"Output: {self.output_directory.get()}",
        )

    def _drain_progress_queue(self) -> None:
        try:
            while True:
                self._apply_progress(self.progress_events.get_nowait())
        except queue.Empty:
            pass
        self.root.after(100, self._drain_progress_queue)

    def _apply_progress(self, event: PipelineProgress) -> None:
        self.progress_value.set(event.overall_percent)
        count = f" ({event.completed}/{event.total})" if event.total else ""
        self.progress_status.set(
            f"{event.overall_percent:5.1f}% - Episode {event.episode_number}: "
            f"{event.message}{count}"
        )
        self._append_log(
            f"[{event.overall_percent:5.1f}%] Episode {event.episode_number} / "
            f"{event.stage}: {event.message}{count}\n"
        )

    def _append_log(self, text: str) -> None:
        self.log.insert("end", text)
        self.log.see("end")

    def _set_busy(self, busy: bool) -> None:
        state = "disabled" if busy else "normal"
        self.analyze_button.configure(state=state)
        self.translate_button.configure(state=state)


def default_output_directory() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "output" / "episodes"
    return Path(__file__).resolve().parents[1] / "output" / "episodes"


def main() -> None:
    root = tk.Tk()
    SubtitleProcessorApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
