; TenderAssist installer additions (electron-builder NSIS include).
;
; After the app is copied, make sure the DSC signer can run: OpenWebStart and
; Java 8 or newer are checked, and whatever is missing is downloaded and
; installed in the same setup (see prereqs.ps1). Silent installs (automatic
; updates) skip it: the computer was already set up, and an update must never
; stop to ask for permission.

!macro customInstall
  IfSilent prereqs_done
  SetDetailsPrint both
  DetailPrint "Checking for OpenWebStart and Java (needed for the DSC signer)..."
  File "/oname=$PLUGINSDIR\prereqs.ps1" "${BUILD_RESOURCES_DIR}\prereqs.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\prereqs.ps1"'
  Pop $0
  StrCmp $0 "0" prereqs_done
  MessageBox MB_OK|MB_ICONINFORMATION "TenderAssist is installed, but OpenWebStart or Java could not be set up (code $0).$\r$\n$\r$\nThe DSC signer needs them to sign in to the portal. TenderAssist will offer the OpenWebStart download before your first search, or you can run this setup again when online." /SD IDOK
  prereqs_done:
!macroend
