; TenderAssist installer additions (electron-builder NSIS include).
;
; After the app is copied, make sure the DSC signer can run: OpenWebStart and
; Java 8 or newer are checked, and whatever is missing is downloaded and
; installed in the same setup (see prereqs.ps1). Silent installs (automatic
; updates) skip it: the computer was already set up, and an update must never
; stop to ask for permission.

; The licence key: a page after the install folder asks for it and checks it
; with the key server (check-key.ps1). The key is saved for the app, which
; activates it with a Google sign-in on first start. Keep LICENCE_SERVER_URL
; equal to src/licence/licenceServer.ts (a test checks).
!define LICENCE_SERVER_URL "https://script.google.com/macros/s/AKfycbxv6T28eEY342oou_V_f6NyjnKZ4syRmFkceDA3S5hIJ5eTmheP_LXL5OElTCD0QhdI/exec"

!ifndef BUILD_UNINSTALLER
; This file is read before electron-builder's own MUI2 include (it is guarded, so twice is fine).
!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh

Var LicenceKeyField
Var LicenceKey

!macro customPageAfterChangeDir
  Page custom LicenceKeyPage LicenceKeyPageLeave
!macroend

Function LicenceKeyPage
  ; Already activated on this PC (a reinstall or a manual upgrade): no need to ask.
  IfFileExists "$APPDATA\TenderAssist\licence.json" 0 +2
    Abort
  !insertmacro MUI_HEADER_TEXT "Activation key" "Paste the TenderAssist key you were given."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "Your key looks like TA-XXXXX-XXXXX-XXXXX-XXXXX. It came by message or email from whoever set up TenderAssist for you."
  Pop $0
  ${NSD_CreateText} 0 30u 100% 14u "$LicenceKey"
  Pop $LicenceKeyField
  ${NSD_CreateLabel} 0 54u 100% 36u "When TenderAssist first opens, it asks you to sign in with Google. The key is linked to that Google account."
  Pop $0
  ${NSD_SetFocus} $LicenceKeyField
  nsDialogs::Show
FunctionEnd

Function LicenceKeyPageLeave
  ${NSD_GetText} $LicenceKeyField $LicenceKey
  ${If} $LicenceKey == ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "Paste your activation key to continue."
    Abort
  ${EndIf}
  InitPluginsDir
  File "/oname=$PLUGINSDIR\check-key.ps1" "${BUILD_RESOURCES_DIR}\check-key.ps1"
  ; The key goes in through the environment, never the command line.
  System::Call 'Kernel32::SetEnvironmentVariable(t "TA_KEY", t "$LicenceKey")'
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\check-key.ps1" -Server "${LICENCE_SERVER_URL}"'
  Pop $0
  Pop $1
  ${If} $0 == "2"
    MessageBox MB_OK|MB_ICONEXCLAMATION "This key cannot be used.$\r$\n$\r$\n$1"
    Abort
  ${ElseIf} $0 == "3"
    MessageBox MB_OK|MB_ICONINFORMATION "The key could not be checked now (no internet?). Setup will continue; TenderAssist checks the key when it first opens."
  ${EndIf}
FunctionEnd
!endif

!macro customInstall
  ; Windows caches a shortcut's icon by path: after installing over an older
  ; build, the desktop icon can stay Electron's until the cache is refreshed.
  ; Runs for silent updates too.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; Hand the key from the key page to the app (it reads licence-key.txt once).
  !ifndef BUILD_UNINSTALLER
  ${If} $LicenceKey != ""
    CreateDirectory "$APPDATA\TenderAssist"
    FileOpen $2 "$APPDATA\TenderAssist\licence-key.txt" w
    FileWrite $2 "$LicenceKey"
    FileClose $2
  ${EndIf}
  !endif
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
