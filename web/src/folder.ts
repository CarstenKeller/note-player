// Reading all sheets of a folder: the pictures and PDFs in it, in the order they were saved
// there (usually screenshots: their time stamp tells the order); files of the same second by
// their names as people count ("Seite 2" before "Seite 10").

const naturally = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Pictures and PDFs (by their name or type). */
export const isSheetFile = (f: { name: string; type?: string }) =>
  /\.(pdf|jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(f.name) || /^image\//.test(f.type ?? '') || f.type === 'application/pdf';

/** Sorts files by their names (with paths: folder by folder) as people count. */
export function sortedByName<T extends { name: string; webkitRelativePath?: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => naturally.compare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));
}

/**
 * Sorts files by the time they were saved (to the second; the browser knows no other time of a
 * file), files of the same second by their names; [byName] false: those keep their order.
 */
export function sortedByTime<T extends { name: string; lastModified: number; webkitRelativePath?: string }>(files: T[], byName = true): T[] {
  return [...files].sort((a, b) =>
    Math.floor(a.lastModified / 1000) - Math.floor(b.lastModified / 1000) ||
    (byName ? naturally.compare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name) : 0));
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
  return { name: dir.name, files: sortedByTime(files) };
}

/** The sheets of a folder chosen with the file input (webkitdirectory), sorted, with its name. */
export function folderFromInput(list: File[]): { name: string; files: File[] } {
  // (where the browser can only choose files: photos without names of their own keep their order)
  const files = importOrder(list.filter(isSheetFile));
  const name = files[0]?.webkitRelativePath?.split('/')[0] || '';
  return { name, files };
}

/**
 * The order of chosen files: by the time they were saved when the browser tells different
 * times; within the same second (or without times) by their names when they have names of their
 * own (files from a folder in "Dateien"), else (photos from the photo library are all called
 * "image.jpg" and the like) in the order they were chosen.
 */
export function importOrder(files: File[]): File[] {
  const names = files.map((f) => f.name);
  const own = new Set(names).size === names.length && !names.every((n) => /^(image|img_?\d*|photo)\b/i.test(n));
  return sortedByTime(files, own);
}
