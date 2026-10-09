import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';

// Windows 10 and 11 ship an OCR engine (Windows.Media.Ocr) and a PDF renderer
// (Windows.Data.Pdf); nothing to install. They are reached through Windows
// PowerShell. Checked on 9 Oct 2026 on a scanned BPCL scope of work: about
// 0.4 s a page, English recogniser from the user's language settings.

const SCRIPT = String.raw`param([string]$Pdf, [string]$Pages = '', [string]$Image = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$methods = [System.WindowsRuntimeSystemExtensions].GetMethods()
$asTaskOp = ($methods | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' })[0]
$asTaskAction = ($methods | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]
function Await($op, [Type]$type) { $t = $asTaskOp.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
function AwaitAction($op) { $asTaskAction.Invoke($null, @($op)).Wait(-1) | Out-Null }
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw 'No OCR language is installed in Windows.' }
function Read-Bitmap($stream) {
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  ($result.Lines | ForEach-Object { $_.Text }) -join "` + '`' + String.raw`n"
}
$out = @()
if ($Image) {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Image)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  $out += @{ page = 1; text = (Read-Bitmap $stream) }
} else {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Pdf)) ([Windows.Storage.StorageFile])
  $doc = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
  foreach ($n in ($Pages -split ',' | Where-Object { $_ })) {
    $index = [int]$n - 1
    if ($index -lt 0 -or $index -ge $doc.PageCount) { continue }
    $page = $doc.GetPage($index)
    $stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    $options = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $options.DestinationWidth = [uint32]([Math]::Min(2400, [Math]::Max(1200, $page.Size.Width * 2.5)))
    AwaitAction ($page.RenderToStreamAsync($stream, $options))
    $out += @{ page = [int]$n; text = (Read-Bitmap $stream) }
  }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3
`;

let scriptPath: string | null = null;

function ensureScript(): string {
  if (scriptPath) return scriptPath;
  const dir = join(tmpdir(), 'tenderassist-ocr');
  mkdirSync(dir, { recursive: true });
  scriptPath = join(dir, 'ocr-v1.ps1');
  // A byte order mark keeps Windows PowerShell 5.1 reading the script as UTF-8.
  writeFileSync(scriptPath, '﻿' + SCRIPT, 'utf8');
  return scriptPath;
}

/** Whether Windows OCR can be used on this computer. */
export function windowsOcrAvailable(): boolean {
  return process.platform === 'win32';
}

function runScript(args: string[], timeoutMs: number): Promise<Array<{ page: number; text: string }>> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ensureScript(), ...args],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) { reject(new Error(`Windows OCR failed: ${(stderr || error.message).trim().split('\n')[0]}`)); return; }
        try {
          const parsed = JSON.parse(stdout.trim() || '[]') as Array<{ page: number; text: string | null }>;
          resolve(parsed.map((entry) => ({ page: Number(entry.page), text: entry.text ?? '' })));
        } catch {
          reject(new Error('Windows OCR gave an answer that could not be read.'));
        }
      });
  });
}

/**
 * Windows' PDF and OCR components refuse paths over 260 characters, which
 * long GeM titles reach (a 286-character path, 9 Oct 2026). Such a file is
 * read from a short copy in the temp folder.
 */
async function withShortPath<T>(path: string, read: (shortPath: string) => Promise<T>): Promise<T> {
  const full = win32.resolve(path);
  if (full.length < 240) return read(full);
  const copy = win32.join(win32.resolve(tmpdir()), 'tenderassist-ocr', `${randomUUID()}${win32.extname(full)}`);
  mkdirSync(win32.dirname(copy), { recursive: true });
  copyFileSync(full, copy);
  try { return await read(copy); } finally { rmSync(copy, { force: true }); }
}

/** OCR the given PDF pages (1-based). */
export async function ocrPdfPages(pdfPath: string, pages: number[]): Promise<Map<number, string>> {
  if (pages.length === 0) return new Map();
  // Windows' file API takes only backslashed, absolute, short paths.
  const result = await withShortPath(pdfPath, (path) => runScript(['-Pdf', path, '-Pages', pages.join(',')], 20_000 + pages.length * 15_000));
  return new Map(result.map((entry) => [entry.page, entry.text]));
}

/** OCR one image file (JPG, PNG, TIFF, BMP). */
export async function ocrImage(imagePath: string): Promise<string> {
  const result = await withShortPath(imagePath, (path) => runScript(['-Image', path], 60_000));
  return result.map((entry) => entry.text).join('\n');
}
