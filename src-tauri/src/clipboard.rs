//! Reading files off the OS clipboard for in-app paste (Finder/Explorer "Copy" →
//! paste on the Send screen). The webview's paste event can't expose real
//! filesystem paths, so we read the native pasteboard here.

/// File paths currently on the clipboard (empty if none / unsupported platform).
#[cfg(target_os = "macos")]
pub fn clipboard_file_paths() -> Vec<String> {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSArray, NSString};

    objc2::rc::autoreleasepool(|_| {
        // Reading the general pasteboard is safe from any thread.
        let pb = NSPasteboard::generalPasteboard();
        // Legacy filenames type still yields an array of POSIX paths and avoids
        // the class-array dance of readObjectsForClasses.
        let ty = NSString::from_str("NSFilenamesPboardType");
        let Some(plist) = pb.propertyListForType(&ty) else {
            return Vec::new();
        };
        // The plist is an NSArray of NSString POSIX paths.
        let Ok(arr) = plist.downcast::<NSArray>() else {
            return Vec::new();
        };
        let mut out = Vec::with_capacity(arr.count());
        for i in 0..arr.count() {
            if let Ok(s) = arr.objectAtIndex(i).downcast::<NSString>() {
                out.push(s.to_string());
            }
        }
        out
    })
}

#[cfg(not(target_os = "macos"))]
pub fn clipboard_file_paths() -> Vec<String> {
    Vec::new()
}
