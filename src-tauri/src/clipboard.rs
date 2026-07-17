//! File clipboard (1.13.x) — put real files on the OS clipboard so they
//! paste into the file manager as files, and read files pasted back.
//!
//! Windows: CF_HDROP + the "Preferred DropEffect" shell format that
//! Explorer reads to decide copy vs move. Non-Windows targets get stubs
//! that error cleanly (the mac CI build must still compile).

#[cfg(windows)]
mod imp {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard,
        RegisterClipboardFormatW, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::CF_HDROP;
    use windows::Win32::UI::Shell::{DragQueryFileW, DROPFILES, HDROP};

    /// RAII guard: OpenClipboard on new(), CloseClipboard on drop.
    struct Clip;
    impl Clip {
        fn open() -> Result<Self, String> {
            unsafe { OpenClipboard(HWND(0)) }.map_err(|e| format!("OpenClipboard: {e}"))?;
            Ok(Clip)
        }
    }
    impl Drop for Clip {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().collect()
    }

    /// Allocate a moveable HGLOBAL of `bytes` and copy `data` into it.
    unsafe fn global_from(data: &[u8]) -> Result<HGLOBAL, String> {
        let h = GlobalAlloc(GMEM_MOVEABLE, data.len()).map_err(|e| format!("GlobalAlloc: {e}"))?;
        let ptr = GlobalLock(h);
        if ptr.is_null() {
            return Err("GlobalLock returned null".into());
        }
        std::ptr::copy_nonoverlapping(data.as_ptr(), ptr as *mut u8, data.len());
        let _ = GlobalUnlock(h);
        Ok(h)
    }

    pub fn set_files(paths: &[String], cut: bool) -> Result<(), String> {
        if paths.is_empty() {
            return Err("no paths".into());
        }
        // Build the CF_HDROP payload: DROPFILES header, then a
        // double-null-terminated list of null-terminated wide paths.
        let mut list: Vec<u16> = Vec::new();
        for p in paths {
            list.extend(to_wide(p));
            list.push(0);
        }
        list.push(0); // extra terminator ending the list

        let header_size = std::mem::size_of::<DROPFILES>();
        let list_bytes = list.len() * 2;
        let mut buf = vec![0u8; header_size + list_bytes];

        let df = DROPFILES {
            pFiles: header_size as u32, // offset to the file list
            pt: Default::default(),
            fNC: false.into(),
            fWide: true.into(), // wide (UTF-16) paths
        };
        unsafe {
            std::ptr::copy_nonoverlapping(
                &df as *const DROPFILES as *const u8,
                buf.as_mut_ptr(),
                header_size,
            );
            std::ptr::copy_nonoverlapping(
                list.as_ptr() as *const u8,
                buf.as_mut_ptr().add(header_size),
                list_bytes,
            );
        }

        let _clip = Clip::open()?;
        unsafe {
            EmptyClipboard().map_err(|e| format!("EmptyClipboard: {e}"))?;

            let hdrop = global_from(&buf)?;
            // SetClipboardData takes ownership of the HGLOBAL on success;
            // never free it ourselves afterward.
            SetClipboardData(CF_HDROP.0 as u32, HANDLE(hdrop.0 as isize))
                .map_err(|e| format!("SetClipboardData(CF_HDROP): {e}"))?;

            // "Preferred DropEffect" = DROPEFFECT_COPY (1) / _MOVE (2).
            // Explorer reads this on paste to choose copy vs cut.
            let fmt = RegisterClipboardFormatW(PCWSTR(
                to_wide("Preferred DropEffect\0").as_ptr(),
            ));
            if fmt != 0 {
                let effect: u32 = if cut { 2 } else { 1 };
                let heff = global_from(&effect.to_le_bytes())?;
                let _ = SetClipboardData(fmt, HANDLE(heff.0 as isize));
            }
        }
        Ok(())
    }

    pub fn get_files() -> Result<Vec<String>, String> {
        let _clip = Clip::open()?;
        unsafe {
            let handle =
                GetClipboardData(CF_HDROP.0 as u32).map_err(|_| "no files on clipboard".to_string())?;
            if handle.0 == 0 {
                return Ok(Vec::new());
            }
            let hdrop = HDROP(handle.0);
            let count = DragQueryFileW(hdrop, 0xFFFF_FFFF, None);
            let mut out = Vec::with_capacity(count as usize);
            for i in 0..count {
                let len = DragQueryFileW(hdrop, i, None);
                if len == 0 {
                    continue;
                }
                let mut buf = vec![0u16; len as usize + 1];
                let got = DragQueryFileW(hdrop, i, Some(&mut buf));
                if got > 0 {
                    out.push(String::from_utf16_lossy(&buf[..got as usize]));
                }
            }
            Ok(out)
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn set_files(_paths: &[String], _cut: bool) -> Result<(), String> {
        Err("file clipboard is only supported on Windows".into())
    }
    pub fn get_files() -> Result<Vec<String>, String> {
        Ok(Vec::new())
    }
}

/// Put real files on the OS clipboard. `cut = true` marks them for a move
/// (Explorer removes the source on paste); `false` = copy.
#[tauri::command]
pub fn clipboard_set_files(paths: Vec<String>, cut: bool) -> Result<(), String> {
    imp::set_files(&paths, cut)
}

/// Read file paths currently on the clipboard (from Explorer copy/cut).
/// Returns an empty list when the clipboard holds no files.
#[tauri::command]
pub fn clipboard_get_files() -> Result<Vec<String>, String> {
    imp::get_files()
}
