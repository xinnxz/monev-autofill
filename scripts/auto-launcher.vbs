' Peluncur tersembunyi untuk tugas MonevAuto.
' 1) Cek diam-diam (tanpa jendela) apakah konfirmasi perlu dimunculkan.
' 2) Hanya kalau perlu (kode 10), buka jendela terminal konfirmasi.
Option Explicit
Dim sh, fso, dir, node, tsx, rc
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = dir
tsx = """" & dir & "\node_modules\tsx\dist\cli.mjs" & """"

rc = sh.Run("cmd /c node " & tsx & " src\main.ts --auto --gate-only >> logs\auto.log 2>&1", 0, True)
If rc = 10 Then
  sh.Run "cmd /c title Monev MagangHub && node " & tsx & " src\main.ts --auto --confirm", 1, True
End If
