; Menú contextual de Windows (clic derecho) para PDF Master. Solo para el usuario actual (HKCU): no requiere administrador.
; Cada acción llama a:  "PDF Master.exe" --pm-action=<acción> "archivo"

!macro PMVerb KEY ID LABEL ACTION
  WriteRegStr HKCU "${KEY}\shell\${ID}" "MUIVerb" "${LABEL}"
  WriteRegStr HKCU "${KEY}\shell\${ID}\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --pm-action=${ACTION} "%1"'
!macroend

; Entrada simple (sin submenú) para imágenes y documentos de Office
!macro PMSingle EXT ACTION
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\PDFMasterToPdf" "MUIVerb" "Convertir a PDF con PDF Master"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\PDFMasterToPdf" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\PDFMasterToPdf\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --pm-action=${ACTION} "%1"'
!macroend

!macro PMSingleRemove EXT
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\PDFMasterToPdf"
!macroend

!macro customInstall
  ; --- Archivos .pdf: submenú "PDF Master"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\PDFMaster" "MUIVerb" "PDF Master"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\PDFMaster" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\PDFMaster" "SubCommands" ""
  !insertmacro PMVerb "Software\Classes\SystemFileAssociations\.pdf\shell\PDFMaster" "01open" "Abrir con PDF Master" "open"
  !insertmacro PMVerb "Software\Classes\SystemFileAssociations\.pdf\shell\PDFMaster" "02merge" "Unir PDFs seleccionados" "merge"
  !insertmacro PMVerb "Software\Classes\SystemFileAssociations\.pdf\shell\PDFMaster" "03split" "Dividir PDF…" "split"
  !insertmacro PMVerb "Software\Classes\SystemFileAssociations\.pdf\shell\PDFMaster" "04compress" "Comprimir PDF" "compress"
  !insertmacro PMVerb "Software\Classes\SystemFileAssociations\.pdf\shell\PDFMaster" "05toword" "Convertir a Word" "toword"
  !insertmacro PMVerb "Software\Classes\SystemFileAssociations\.pdf\shell\PDFMaster" "06toimages" "Convertir a imágenes" "toimages"
  !insertmacro PMVerb "Software\Classes\SystemFileAssociations\.pdf\shell\PDFMaster" "07sign" "Firmar" "sign"
  !insertmacro PMVerb "Software\Classes\SystemFileAssociations\.pdf\shell\PDFMaster" "08protect" "Proteger con contraseña" "protect"
  !insertmacro PMVerb "Software\Classes\SystemFileAssociations\.pdf\shell\PDFMaster" "09ocr" "Hacer buscable (OCR)" "ocr"

  ; --- Imágenes -> PDF
  !insertmacro PMSingle ".png" "imgs2pdf"
  !insertmacro PMSingle ".jpg" "imgs2pdf"
  !insertmacro PMSingle ".jpeg" "imgs2pdf"
  !insertmacro PMSingle ".webp" "imgs2pdf"
  !insertmacro PMSingle ".bmp" "imgs2pdf"
  !insertmacro PMSingle ".gif" "imgs2pdf"

  ; --- Word / Excel / PowerPoint -> PDF
  !insertmacro PMSingle ".doc" "office2pdf"
  !insertmacro PMSingle ".docx" "office2pdf"
  !insertmacro PMSingle ".xls" "office2pdf"
  !insertmacro PMSingle ".xlsx" "office2pdf"
  !insertmacro PMSingle ".ppt" "office2pdf"
  !insertmacro PMSingle ".pptx" "office2pdf"
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\PDFMaster"
  !insertmacro PMSingleRemove ".png"
  !insertmacro PMSingleRemove ".jpg"
  !insertmacro PMSingleRemove ".jpeg"
  !insertmacro PMSingleRemove ".webp"
  !insertmacro PMSingleRemove ".bmp"
  !insertmacro PMSingleRemove ".gif"
  !insertmacro PMSingleRemove ".doc"
  !insertmacro PMSingleRemove ".docx"
  !insertmacro PMSingleRemove ".xls"
  !insertmacro PMSingleRemove ".xlsx"
  !insertmacro PMSingleRemove ".ppt"
  !insertmacro PMSingleRemove ".pptx"
!macroend
