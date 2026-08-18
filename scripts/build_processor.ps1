$ErrorActionPreference = "Stop"

python -m PyInstaller --noconfirm --clean --onefile --windowed `
  --name SubtitleProcessor `
  --distpath dist `
  desktop/subtitle_processor_txt_key.py

Write-Host "Built dist/SubtitleProcessor.exe"
Write-Host "This build always reads API key for openAI.txt from the project root."
