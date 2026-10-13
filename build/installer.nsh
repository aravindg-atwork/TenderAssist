; TenderAssist installer additions (electron-builder NSIS include).
;
; The DSC signer (OpenWebStart and Java 8 or newer) is optional: a page looks
; for both and, when something is missing, explains why it is needed and
; offers to install it, only if ticked (prereqs.ps1). Silent installs
; (automatic updates) never ask or install. TenderAssist's Settings > DSC
; signer installs them later with the same script.

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

; The terms page (build/license.txt): "I accept" / "I do not accept" buttons
; instead of a single "I Agree"; Next stays off until "I accept" is chosen.
!define MUI_LICENSEPAGE_RADIOBUTTONS
!define MUI_LICENSEPAGE_RADIOBUTTONS_TEXT_ACCEPT "I accept the agreement"
!define MUI_LICENSEPAGE_RADIOBUTTONS_TEXT_DECLINE "I do not accept the agreement"
!define MUI_LICENSEPAGE_TEXT_TOP "Please read the whole agreement (scroll down). TenderAssist installs only if you accept it."

Var LicenceKeyField
Var LicenceKey
; The DSC signer page: what is missing (prereqs.ps1 -DetectOnly exit code) and the operator's choice.
Var SignerMissing
Var SignerCheckbox
Var InstallSigner

!macro customPageAfterChangeDir
  Page custom LicenceKeyPage LicenceKeyPageLeave
  Page custom SignerPage SignerPageLeave
!macroend

; OpenWebStart and Java run the GePNIC portals' DSC signer. If either is
; missing, this page explains why and offers to install them, only when
; ticked (off by default). Without them TenderAssist still installs and
; works; Settings > DSC signer installs them later.
Function SignerPage
  StrCpy $InstallSigner 0
  InitPluginsDir
  File "/oname=$PLUGINSDIR\prereqs.ps1" "${BUILD_RESOURCES_DIR}\prereqs.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\prereqs.ps1" -DetectOnly'
  Pop $SignerMissing
  Pop $0
  ; Both found: nothing to offer.
  ${If} $SignerMissing == "0"
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "DSC signer (optional)" "For signing in to Tamil Nadu and other GePNIC tender websites with your DSC."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 34u "GePNIC tender websites (such as Tamil Nadu's) sign you in with your Digital Signature Certificate through a small $\"DSC signer$\" program from the website. That program needs OpenWebStart and Java 8 or newer to run."
  Pop $0
  ${If} $SignerMissing == "11"
    StrCpy $1 "Missing on this computer: Java 8 or newer (about 31 MB). OpenWebStart is already installed."
  ${ElseIf} $SignerMissing == "12"
    StrCpy $1 "Missing on this computer: OpenWebStart (about 70 MB). Java is already installed."
  ${Else}
    StrCpy $1 "Missing on this computer: Java 8 or newer (about 31 MB) and OpenWebStart (about 70 MB)."
  ${EndIf}
  ${NSD_CreateLabel} 0 38u 100% 18u "$1"
  Pop $0
  ${NSD_CreateCheckbox} 0 60u 100% 26u "Download and install them now. They come from the official Eclipse Temurin and OpenWebStart releases and are checked before installing. Windows will ask for permission."
  Pop $SignerCheckbox
  ${NSD_CreateLabel} 0 92u 100% 40u "Not now? TenderAssist still installs and works: GeM searches, reading and sorting tenders, Google Drive and reports need nothing more. You can install them any time from TenderAssist: Settings > DSC signer."
  Pop $0
  nsDialogs::Show
FunctionEnd

Function SignerPageLeave
  ${NSD_GetState} $SignerCheckbox $InstallSigner
  ${If} $InstallSigner == ${BST_CHECKED}
    StrCpy $InstallSigner 1
  ${Else}
    StrCpy $InstallSigner 0
  ${EndIf}
FunctionEnd

Function LicenceKeyPage
  ; Already activated on this PC (a reinstall or a manual upgrade): no need to ask.
  IfFileExists "$APPDATA\${PRODUCT_NAME}\licence.json" 0 +2
    Abort
  !insertmacro MUI_HEADER_TEXT "Activation key" "Paste the TenderAssist key you were given (or leave it empty on a further computer)."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 24u "Your key looks like TA-XXXXX-XXXXX-XXXXX-XXXXX. It came by message or email from whoever set up TenderAssist for you."
  Pop $0
  ${NSD_CreateText} 0 30u 100% 14u "$LicenceKey"
  Pop $LicenceKeyField
  ${NSD_CreateLabel} 0 54u 100% 50u "When TenderAssist first opens, it asks you to sign in with Google. The key is linked to that Google account.$\r$\n$\r$\nAlready use TenderAssist on another computer? Leave the key empty: signing in with the same Google account is enough."
  Pop $0
  ${NSD_SetFocus} $LicenceKeyField
  nsDialogs::Show
FunctionEnd

Function LicenceKeyPageLeave
  ${NSD_GetText} $LicenceKeyField $LicenceKey
  ; Empty: a further PC of a customer; the app activates it with Google alone.
  ${If} $LicenceKey == ""
    Return
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
    CreateDirectory "$APPDATA\${PRODUCT_NAME}"
    FileOpen $2 "$APPDATA\${PRODUCT_NAME}\licence-key.txt" w
    FileWrite $2 "$LicenceKey"
    FileClose $2
  ${EndIf}
  ; OpenWebStart and Java only when the operator ticked them on the DSC signer page.
  IfSilent prereqs_done
  ${If} $InstallSigner != 1
    Goto prereqs_done
  ${EndIf}
  SetDetailsPrint both
  DetailPrint "Installing what the DSC signer needs (OpenWebStart and Java)..."
  File "/oname=$PLUGINSDIR\prereqs.ps1" "${BUILD_RESOURCES_DIR}\prereqs.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\prereqs.ps1"'
  Pop $0
  StrCmp $0 "0" prereqs_done
  MessageBox MB_OK|MB_ICONINFORMATION "TenderAssist is installed, but OpenWebStart or Java could not be set up (code $0).$\r$\n$\r$\nYou can install them later from TenderAssist: Settings > DSC signer." /SD IDOK
  prereqs_done:
  !endif
!macroend
