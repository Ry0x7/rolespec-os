; Tauri's NSIS template records ProductName, FileVersion and LegalCopyright but
; omits CompanyName. Explorer shows that as missing publisher metadata. NSIS
; version keys are compile-time, so defining it here applies to the setup
; executable the template compiles.
VIAddVersionKey "CompanyName" "Chryypt Inc"

; Runtime files that Next.js writes after installation (route cache, favicons)
; are not in the uninstaller's file list, so the default uninstall leaves the
; resources tree behind. Remove the whole runtime directory; user data lives in
; %LOCALAPPDATA%\RoleSpecData and is intentionally untouched.
!macro NSIS_HOOK_PREUNINSTALL
  RMDir /r "$INSTDIR\resources"
!macroend

; The stock uninstaller removes its recorded files but leaves the install root
; behind. The preuninstall hook above clears the runtime tree; remove the now
; empty directory after the standard uninstall steps so an uninstall leaves no
; empty "%LOCALAPPDATA%\RoleSpec" behind.
!macro NSIS_HOOK_POSTUNINSTALL
  RMDir "$INSTDIR"
!macroend
