from __future__ import annotations

import os
import tkinter as tk
from tkinter import ttk

from desktop import subtitle_processor as base

API_KEY_SOURCE_LABEL = f"{base.PRIVATE_API_KEY_FILENAME} (project root)"


class TxtKeySubtitleProcessorApp(base.SubtitleProcessorApp):
    """Desktop processor that always uses the project-root API key text file."""

    def __init__(self, root: tk.Tk) -> None:
        os.environ.pop("OPENAI_API_KEY", None)
        super().__init__(root)
        self.api_key.set(API_KEY_SOURCE_LABEL)
        self._lock_api_key_override_ui()

    def _lock_api_key_override_ui(self) -> None:
        for widget in _walk_widgets(self.root):
            if (
                isinstance(widget, ttk.Label)
                and widget.cget("text") == "API key override (optional)"
            ):
                widget.configure(text="API key source")
            if isinstance(widget, ttk.Entry) and widget.cget("textvariable") == str(self.api_key):
                widget.configure(state="disabled", show="")

    def translate(self) -> None:
        self.api_key.set("")
        try:
            super().translate()
        finally:
            self.api_key.set(API_KEY_SOURCE_LABEL)


def _walk_widgets(widget: tk.Misc):
    for child in widget.winfo_children():
        yield child
        yield from _walk_widgets(child)


def main() -> None:
    root = tk.Tk()
    TxtKeySubtitleProcessorApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
