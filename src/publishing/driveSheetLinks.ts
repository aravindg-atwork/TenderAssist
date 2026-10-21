import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// A report sheet links each tender's saved documents by a path relative to the
// sheet ("01 - Title/Documents"): it opens the folder in Excel on this
// computer. Opened from Google Drive, the same link opens the sheet again, so
// the copy uploaded to Drive links the folders on Drive instead.

/** A link to a place beside the sheet, not a web address or a place inside the workbook. */
export function isRelativeLink(target: string): boolean {
  return target !== '' && !target.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(target);
}

/** The folder names in a relative link, as written in the sheet. */
export function linkSegments(target: string): string[] {
  return target.split(/[\\/]/).filter((part) => part !== '' && part !== '.').map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  });
}

/**
 * The sheet as it should be on Drive: each relative link replaced by the web
 * link `resolveLink` gives, or by plain text when the folder is not on Drive.
 * The copy is kept in `cacheDirectory` and reused while the sheet and its
 * links are unchanged, so Drive sees the same file and is not sent it again.
 * Returns the path of the copy, or `sourcePath` itself when it has no
 * relative links.
 */
export async function driveCopyOfSheet(
  sourcePath: string,
  cacheDirectory: string,
  resolveLink: (target: string) => Promise<string | null>,
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(sourcePath);
  const cells: ExcelJS.Cell[] = [];
  workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => {
    const value = cell.value as { hyperlink?: unknown } | null;
    if (value && typeof value === 'object' && typeof value.hyperlink === 'string' && isRelativeLink(value.hyperlink)) cells.push(cell);
  })));
  if (cells.length === 0) return sourcePath;

  const targets = new Map<string, string | null>();
  for (const cell of cells) {
    const target = (cell.value as { hyperlink: string }).hyperlink;
    if (!targets.has(target)) targets.set(target, await resolveLink(target));
  }

  const sourceKey = createHash('sha1').update(sourcePath.toLocaleLowerCase()).digest('hex').slice(0, 16);
  const contentKey = createHash('sha1').update(readFileSync(sourcePath)).update(JSON.stringify([...targets])).digest('hex').slice(0, 16);
  const copyPath = join(cacheDirectory, `${sourceKey}-${contentKey}.xlsx`);
  if (existsSync(copyPath)) return copyPath;

  for (const cell of cells) {
    const value = cell.value as { text?: unknown; hyperlink: string };
    const text = typeof value.text === 'string' ? value.text : String(value.text ?? '');
    const link = targets.get(value.hyperlink);
    if (link) cell.value = { text, hyperlink: link };
    else {
      cell.value = `${text} (on this computer only)`;
      cell.font = {};
    }
  }
  mkdirSync(cacheDirectory, { recursive: true });
  for (const name of readdirSync(cacheDirectory)) {
    if (name.startsWith(`${sourceKey}-`)) rmSync(join(cacheDirectory, name), { force: true });
  }
  await workbook.xlsx.writeFile(copyPath);
  return copyPath;
}
