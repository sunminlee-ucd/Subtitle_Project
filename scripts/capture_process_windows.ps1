param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId,
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory
)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class ProcessWindows {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);

    public static List<IntPtr> Find(uint targetProcessId) {
        var windows = new List<IntPtr>();
        EnumWindows((hWnd, lParam) => {
            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            if (processId == targetProcessId && IsWindowVisible(hWnd)) windows.Add(hWnd);
            return true;
        }, IntPtr.Zero);
        return windows;
    }
}
"@

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$index = 0
foreach ($handle in [ProcessWindows]::Find([uint32]$ProcessId)) {
    $rect = New-Object ProcessWindows+RECT
    if (-not [ProcessWindows]::GetWindowRect($handle, [ref]$rect)) { continue }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -le 1 -or $height -le 1) { continue }

    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $deviceContext = $graphics.GetHdc()
    [void][ProcessWindows]::PrintWindow($handle, $deviceContext, 2)
    $graphics.ReleaseHdc($deviceContext)
    $graphics.Dispose()
    $outputPath = Join-Path $OutputDirectory ("window-{0}.png" -f $index)
    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    [pscustomobject]@{ Index=$index; Handle=$handle; Width=$width; Height=$height; Path=$outputPath }
    $index++
}
