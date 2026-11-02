// Reading all sheets of a folder: the pictures and PDFs in it, sorted by their names as people
// count ("Seite 2" before "Seite 10").

const naturally = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Pictures and PDFs (by their name or type). */
export const isSheetFile = (f: { name: string; type?: string }) =>
  /\.(pdf|jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(f.name) || /^image\//.test(f.type ?? '') || f.type === 'application/pdf';

/** Sorts files by their names (with paths: folder by folder) as people count. */
export function sortedByName<T extends { name: string; webkitRelativePath?: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => naturally.compare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));
}

/** Whether this browser can let the user choose a whole folder. */
export function canChooseFolder(): boolean {
  if (typeof window === 'undefined') return false;
  if ('showDirectoryPicker' in window) return true;
  // the older way (desktop browsers); phones and tablets mostly ignore it
  return 'webkitdirectory' in document.createElement('input') && !/iPad|iPhone|Android/i.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

type DirHandle = { name: string; values(): AsyncIterable<{ kind: string; name: string; getFile?: () => Promise<File> }> };

/**
 * Lets the user choose a folder and gives its sheets, sorted, with the folder's name; null when
 * nothing was chosen. Where the folder picker is missing, [fallback] opens the file input that
 * chooses a folder the older way.
 */
export async function chooseFolder(fallback: () => void): Promise<{ name: string; files: File[] } | null> {
  const pick = (window as unknown as { showDirectoryPicker?: () => Promise<DirHandle> }).showDirectoryPicker;
  if (!pick) {
    fallback();
    return null;
  }
  let dir: DirHandle;
  try {
    dir = await pick.call(window);
  } catch {
    return null; // not chosen
  }
  const files: File[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind !== 'file' || !entry.getFile || !isSheetFile(entry)) continue;
    files.push(await entry.getFile());
  }
  return { name: dir.name, files: sortedByName(files) };
}

/** The sheets of a folder chosen with the file input (webkitdirectory), sorted, with its name. */
export function folderFromInput(list: File[]): { name: string; files: File[] } {
  const files = sortedByName(list.filter(isSheetFile));
  const name = files[0]?.webkitRelativePath?.split('/')[0] || '';
  return { name, files };
}

/**
 * The order of chosen files: by their names when they have names of their own (files from a
 * folder in "Dateien"); photos from the photo library are all called "image.jpg" and the like:
 * they keep the order they were chosen in.
 */
export function importOrder(files: File[]): File[] {
  const names = files.map((f) => f.name);
  const own = new Set(names).size === names.length && !names.every((n) => /^(image|img_?\d*|photo)\b/i.test(n));
  return own ? sortedByName(files) : files;
}
