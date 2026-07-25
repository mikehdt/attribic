/** A dropped file paired with where it sat in the dropped folder structure. */
export type DroppedFile = {
  file: File;
  /** Path relative to the drop root, e.g. `2_chara/cat.png`. */
  relativePath: string;
};

/**
 * Deepest folder level walked into a dropped tree. Only the root and one repeat
 * folder are meaningful to a project, so this is just a guard against pointing
 * the app at something pathological.
 */
const MAX_DEPTH = 6;

/**
 * Whether a drag is carrying files, as opposed to text or a link dragged from
 * within the page. Also what keeps the tag drag-and-drop clear of the importer.
 */
export const dataTransferHasFiles = (
  dataTransfer: DataTransfer | null,
): boolean =>
  !!dataTransfer && Array.from(dataTransfer.types).includes('Files');

const fileFromEntry = (entry: FileSystemFileEntry): Promise<File | null> =>
  new Promise((resolve) => {
    entry.file(resolve, () => resolve(null));
  });

/**
 * Read a directory to the end. `readEntries` returns at most 100 per call and
 * signals completion with an empty batch, so it has to be drained in a loop.
 */
const readAllEntries = (
  directory: FileSystemDirectoryEntry,
): Promise<FileSystemEntry[]> =>
  new Promise((resolve) => {
    const reader = directory.createReader();
    const all: FileSystemEntry[] = [];

    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(all);
            return;
          }
          all.push(...batch);
          readBatch();
        },
        () => resolve(all),
      );
    };

    readBatch();
  });

const collectEntry = async (
  entry: FileSystemEntry,
  parentPath: string,
  depth: number,
  collected: DroppedFile[],
): Promise<void> => {
  const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const file = await fileFromEntry(entry as FileSystemFileEntry);
    if (file) collected.push({ file, relativePath });
    return;
  }

  if (entry.isDirectory && depth < MAX_DEPTH) {
    const children = await readAllEntries(entry as FileSystemDirectoryEntry);
    for (const child of children) {
      await collectEntry(child, relativePath, depth + 1, collected);
    }
  }
};

/**
 * Flatten a drop into files plus their paths within any dropped folders.
 *
 * The entries have to be pulled off the `DataTransfer` synchronously — the item
 * list is cleared as soon as the drop handler returns, so `webkitGetAsEntry` is
 * called for everything up front and only the traversal is awaited.
 */
export const readDroppedFiles = async (
  dataTransfer: DataTransfer,
): Promise<DroppedFile[]> => {
  const entries = Array.from(dataTransfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);

  // No entry API (or nothing resolved) — fall back to the flat file list, which
  // loses folder structure but still gets the files in.
  if (!entries.length) {
    return Array.from(dataTransfer.files).map((file) => ({
      file,
      relativePath: file.name,
    }));
  }

  const collected: DroppedFile[] = [];
  for (const entry of entries) {
    await collectEntry(entry, '', 0, collected);
  }
  return collected;
};

/** Wrap files chosen through a file input, which carry no folder structure. */
export const filesFromInput = (files: FileList): DroppedFile[] =>
  Array.from(files).map((file) => ({ file, relativePath: file.name }));
