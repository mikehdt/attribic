import { execFile } from 'child_process';
import { NextResponse } from 'next/server';

type BrowseResult =
  { path: string; cancelled?: never } | { path?: never; cancelled: true };

/**
 * Opens a native OS file dialog and returns the selected path.
 *
 * Query params:
 *   title  — dialog title (optional)
 *   filter — file extension filter, e.g. "safetensors,ckpt,bin" (optional)
 *   mode   — "file" (default) or "folder"
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title') ?? 'Select file';
  const filter = searchParams.get('filter') ?? '';
  const mode = searchParams.get('mode') === 'folder' ? 'folder' : 'file';

  try {
    const result =
      mode === 'folder'
        ? await openFolderDialog(title)
        : await openFileDialog(title, filter);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function openFileDialog(title: string, filter: string): Promise<BrowseResult> {
  switch (process.platform) {
    case 'win32':
      return openWindows(title, filter);
    case 'darwin':
      return openMacOS(title, filter);
    default:
      return openLinux(title, filter);
  }
}

// --- Windows: PowerShell OpenFileDialog ---

function openWindows(title: string, filter: string): Promise<BrowseResult> {
  const filterString = buildWindowsFilter(filter);
  // -Sta is required for WinForms dialogs
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    `$d.Title = '${escapePS(title)}'`,
    `$d.Filter = '${escapePS(filterString)}'`,
    'if ($d.ShowDialog() -eq "OK") { $d.FileName } else { "" }',
  ].join('; ');

  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-Sta', '-Command', script],
      { timeout: 120_000 },
      (error, stdout) => {
        if (error) return reject(error);
        const selected = stdout.trim();
        resolve(selected ? { path: selected } : { cancelled: true });
      },
    );
  });
}

function buildWindowsFilter(filter: string): string {
  if (!filter) return 'All files (*.*)|*.*';
  const exts = filter.split(',').map((e) => e.trim());
  const pattern = exts.map((e) => `*.${e}`).join(';');
  return `Model files (${pattern})|${pattern}|All files (*.*)|*.*`;
}

function escapePS(s: string): string {
  return s.replace(/'/g, "''");
}

// --- macOS: osascript AppleScript ---

function openMacOS(title: string, filter: string): Promise<BrowseResult> {
  const typeClause = filter
    ? ` of type {${filter
        .split(',')
        .map((e) => `"${e.trim()}"`)
        .join(', ')}}`
    : '';

  const script = `POSIX path of (choose file with prompt "${escapeAS(title)}"${typeClause})`;

  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-e', script],
      { timeout: 120_000 },
      (error, stdout) => {
        // Error code 1 = user cancelled
        if (error && 'code' in error && error.code === 1) {
          return resolve({ cancelled: true });
        }
        if (error) return reject(error);
        const posix = stdout.trim();
        resolve(posix ? { path: posix } : { cancelled: true });
      },
    );
  });
}

function escapeAS(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// --- Linux: zenity, with kdialog fallback ---

function openLinux(title: string, filter: string): Promise<BrowseResult> {
  return openZenity(title, filter).catch(() => openKDialog(title, filter));
}

function openZenity(title: string, filter: string): Promise<BrowseResult> {
  const args = ['--file-selection', `--title=${title}`];
  if (filter) {
    const pattern = filter
      .split(',')
      .map((e) => `*.${e.trim()}`)
      .join(' ');
    args.push(
      `--file-filter=Model files | ${pattern}`,
      '--file-filter=All files | *',
    );
  }

  return new Promise((resolve, reject) => {
    execFile('zenity', args, { timeout: 120_000 }, (error, stdout) => {
      // zenity exit code 1 = cancelled, 5 = timeout/dismissed
      if (error && 'code' in error && (error.code === 1 || error.code === 5)) {
        return resolve({ cancelled: true });
      }
      if (error) return reject(error);
      const selected = stdout.trim();
      resolve(selected ? { path: selected } : { cancelled: true });
    });
  });
}

function openKDialog(title: string, filter: string): Promise<BrowseResult> {
  const filterArg = filter
    ? filter
        .split(',')
        .map((e) => `*.${e.trim()}`)
        .join(' ')
    : '*';
  const args = ['--getopenfilename', '.', filterArg, '--title', title];

  return new Promise((resolve, reject) => {
    execFile('kdialog', args, { timeout: 120_000 }, (error, stdout) => {
      if (error && 'code' in error && error.code === 1) {
        return resolve({ cancelled: true });
      }
      if (error) return reject(error);
      const selected = stdout.trim();
      resolve(selected ? { path: selected } : { cancelled: true });
    });
  });
}

// --- Folder dialog (cross-platform) ---

function openFolderDialog(title: string): Promise<BrowseResult> {
  switch (process.platform) {
    case 'win32':
      return openFolderWindows(title);
    case 'darwin':
      return openFolderMacOS(title);
    default:
      return openFolderLinux(title);
  }
}

function openFolderWindows(title: string): Promise<BrowseResult> {
  // Use IFileOpenDialog COM interface with FOS_PICKFOLDERS for the modern
  // Vista+ folder picker instead of the old tree-view FolderBrowserDialog.
  // C# is compiled via Add-Type and must target C# 5.0 (PowerShell 5.1).
  const csharp = [
    'using System;',
    'using System.Runtime.InteropServices;',
    '',
    'public static class FolderPicker {',
    '  public static string Show(string title) {',
    '    var dialog = (IFileOpenDialog)new FileOpenDialogRCW();',
    '    try {',
    '      uint options; dialog.GetOptions(out options);',
    '      dialog.SetOptions(options | 0x20u);', // FOS_PICKFOLDERS
    '      dialog.SetTitle(title);',
    '      dialog.SetOkButtonLabel("Select Folder");',
    '      int hr = dialog.Show(IntPtr.Zero);',
    '      if (hr != 0) return "";',
    '      IShellItem item; dialog.GetResult(out item);',
    '      string path; item.GetDisplayName(0x80058000u, out path);', // SIGDN_FILESYSPATH
    '      return path ?? "";',
    '    } finally { Marshal.ReleaseComObject(dialog); }',
    '  }',
    '',
    '  [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]',
    '  private class FileOpenDialogRCW {}',
    '',
    '  [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"),',
    '   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    '  private interface IFileOpenDialog {',
    '    [PreserveSig] int Show(IntPtr hwndOwner);',
    '    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);',
    '    void SetFileTypeIndex(uint iFileType);',
    '    void GetFileTypeIndex(out uint piFileType);',
    '    void Advise(IntPtr pfde, out uint pdwCookie);',
    '    void Unadvise(uint dwCookie);',
    '    void SetOptions(uint fos);',
    '    void GetOptions(out uint pfos);',
    '    void SetDefaultFolder(IShellItem psi);',
    '    void SetFolder(IShellItem psi);',
    '    void GetFolder(out IShellItem ppsi);',
    '    void GetCurrentSelection(out IShellItem ppsi);',
    '    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);',
    '    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);',
    '    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);',
    '    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);',
    '    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);',
    '    void GetResult(out IShellItem ppsi);',
    '    void AddPlace(IShellItem psi, int fdap);',
    '    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);',
    '    void Close(int hr);',
    '    void SetClientGuid(ref Guid guid);',
    '    void ClearClientData();',
    '    void SetFilter(IntPtr pFilter);',
    '    void GetResults(out IntPtr ppenum);',
    '    void GetSelectedItems(out IntPtr ppsai);',
    '  }',
    '',
    '  [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"),',
    '   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    '  private interface IShellItem {',
    '    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);',
    '    void GetParent(out IShellItem ppsi);',
    '    void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);',
    '    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);',
    '    void Compare(IShellItem psi, uint hint, out int piOrder);',
    '  }',
    '}',
  ].join('\n');

  const script = `Add-Type -TypeDefinition @'\n${csharp}\n'@\nWrite-Output ([FolderPicker]::Show('${escapePS(title)}'))`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-Sta', '-EncodedCommand', encoded],
      { timeout: 120_000 },
      (error, stdout) => {
        if (error) return reject(error);
        const selected = stdout.trim();
        resolve(selected ? { path: selected } : { cancelled: true });
      },
    );
  });
}

function openFolderMacOS(title: string): Promise<BrowseResult> {
  const script = `POSIX path of (choose folder with prompt "${escapeAS(title)}")`;

  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-e', script],
      { timeout: 120_000 },
      (error, stdout) => {
        if (error && 'code' in error && error.code === 1) {
          return resolve({ cancelled: true });
        }
        if (error) return reject(error);
        const posix = stdout.trim();
        resolve(posix ? { path: posix } : { cancelled: true });
      },
    );
  });
}

function openFolderLinux(title: string): Promise<BrowseResult> {
  const args = ['--file-selection', '--directory', `--title=${title}`];

  return new Promise((resolve, reject) => {
    execFile('zenity', args, { timeout: 120_000 }, (error, stdout) => {
      if (error && 'code' in error && (error.code === 1 || error.code === 5)) {
        return resolve({ cancelled: true });
      }
      if (error) {
        // Fallback to kdialog
        const kdArgs = ['--getexistingdirectory', '.', '--title', title];
        execFile('kdialog', kdArgs, { timeout: 120_000 }, (err2, out2) => {
          if (err2 && 'code' in err2 && err2.code === 1) {
            return resolve({ cancelled: true });
          }
          if (err2) return reject(err2);
          const selected = out2.trim();
          resolve(selected ? { path: selected } : { cancelled: true });
        });
        return;
      }
      const selected = stdout.trim();
      resolve(selected ? { path: selected } : { cancelled: true });
    });
  });
}
