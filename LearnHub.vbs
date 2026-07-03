' YK LearnHub launcher — starts the server (hidden) if needed, then opens the app window
Set sh = CreateObject("WScript.Shell")

running = False
On Error Resume Next
Set http = CreateObject("MSXML2.XMLHTTP")
http.open "GET", "http://localhost:4321/api/face", False
http.send
If Err.Number = 0 Then
  If http.status = 200 Then running = True
End If
On Error GoTo 0

If Not running Then
  sh.Run """C:\Program Files\nodejs\node.exe"" ""E:\LearnHub\server.js""", 0, False
  WScript.Sleep 1800
End If

sh.Run "cmd /c start msedge --app=http://localhost:4321", 0, False
