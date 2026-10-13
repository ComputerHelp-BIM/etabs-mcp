# Using the bridge from DraftWin (VB.NET)

There are two ways to connect DraftWin. Both use code from this repository, and both work from VB.NET on .NET Framework 4.7.2 or newer.

| | A. HTTP via the plugin (recommended) | B. Direct COM attach |
| --- | --- | --- |
| Picks the right ETABS instance | Yes: the discovery folder lists every open model | Yes, if you pass the PID (`GetObjectProcess`) |
| Works when ETABS runs as admin and DraftWin does not (or the reverse) | **Yes**: plain localhost TCP | **No**: COM attach is blocked across elevation levels |
| Needs the plugin running in ETABS | Yes | No |
| References | `EtabsBridge.Core.dll` only | `EtabsBridge.Core.dll`, `EtabsBridge.Etabs.dll`, `ETABSv1.dll` |
| Result type | JSON (`JsonValue`) | Typed DTOs (`GeometrySnapshot`, `FrameMember`, ...) |

Option A fixes both problems from the original discussion (wrong instance, and "sometimes reads nothing" from an
elevation mismatch). Option B is the `GetObjectProcess` approach from that discussion, packaged.

## A. HTTP (recommended)

Reference `plugin\src\EtabsBridge.Core\bin\Release\netstandard2.0\EtabsBridge.Core.dll`.

```vbnet
Imports System.Net.Http
Imports System.Net.Http.Headers
Imports EtabsBridge.Core.Discovery
Imports EtabsBridge.Core.Json

Public Module EtabsBridgeLink
    Private ReadOnly Http As New HttpClient() With {.Timeout = TimeSpan.FromMinutes(2)}

    ''' Every ETABS window that is running the ETABS Bridge plugin.
    Public Function ListOpenModels() As IReadOnlyList(Of InstanceRecord)
        Return New InstanceRegistry().List()
    End Function

    ''' GET /api/v1/{path} from one instance, parsed as JSON.
    Public Async Function GetAsync(instance As InstanceRecord, path As String) As Task(Of JsonValue)
        Using request As New HttpRequestMessage(HttpMethod.Get, instance.BaseUrl & "/api/v1/" & path)
            request.Headers.Authorization = New AuthenticationHeaderValue("Bearer", instance.Token)
            Using response = Await Http.SendAsync(request).ConfigureAwait(False)
                Dim body = Await response.Content.ReadAsStringAsync().ConfigureAwait(False)
                If Not response.IsSuccessStatusCode Then
                    Dim err = JsonParser.Parse(body).Get("error")
                    Throw New InvalidOperationException($"{err?.GetString("code")}: {err?.GetString("message")}")
                End If
                Return JsonParser.Parse(body)
            End Using
        End Using
    End Function
End Module
```

Usage: a pick list of open models, then read the geometry.

```vbnet
Dim models = EtabsBridgeLink.ListOpenModels()
If models.Count = 0 Then
    MessageBox.Show("Open the model in ETABS and run Tools > ETABS Bridge.")
    Return
End If

Dim chosen = models(0) ' or let the user pick by .ModelPath / .ProcessId
Dim geometry = Await EtabsBridgeLink.GetAsync(chosen, "geometry")

Dim lengthUnit = geometry.Get("units").GetString("length")
For Each frame In geometry.Get("frames").AsArray()
    Dim name = frame.GetString("name")
    Dim section = frame.GetString("section")
    Dim kind = frame.GetString("type")          ' Column / Beam / Brace / Null / Other
    Dim x1 = frame.Get("start").Get("x").AsDouble()
    ' ...
Next

' Any database table, e.g. section assignments:
Dim table = Await EtabsBridgeLink.GetAsync(chosen, "tables/data?key=" & Uri.EscapeDataString("Frame Assignments - Section Properties"))
```

## B. Direct attach (no plugin)

Reference `EtabsBridge.Core.dll` and `plugin\src\EtabsBridge.Etabs\bin\Release\net48\EtabsBridge.Etabs.dll`,
plus `ETABSv1.dll` from the ETABS folder (Copy Local = False). Target x64.

```vbnet
Imports EtabsBridge.Core.Model
Imports EtabsBridge.Core.Services
Imports EtabsBridge.Etabs

' Pick list of running ETABS processes (window title usually contains the model name).
For Each p In EtabsConnector.ListRunningInstances()
    instanceList.Items.Add($"{p.ProcessId}: {p.WindowTitle}")
Next

Dim pid As Integer = ...                                 ' the user's choice
Dim sapModel = EtabsConnector.AttachByProcessId(pid)     ' GetObjectProcess, not GetObject
Dim geometry As GeometrySnapshot = New GeometryService(New EtabsApiModel(sapModel), pid).GetSnapshot()

For Each f As FrameMember In geometry.Frames
    Debug.Print($"{f.Name} {f.Type} {f.Section} {f.Start.X},{f.Start.Y},{f.Start.Z}")
Next
```

This gives the same DTOs the plugin serves, so DraftWin code written against `GeometrySnapshot` works the same
whichever way it connects.

## Compatibility notes

- `EtabsBridge.Core` targets **netstandard2.0** and has no NuGet dependencies, so it loads into any .NET Framework
  4.7.2+ or .NET 6+ app, VB.NET or C#.
- All public members use plain types (`String`, `Double`, `IReadOnlyList(Of T)`), with no C#-only features in the API surface.
- The JSON contract is versioned (`/api/v1`, semantic `bridgeVersion`), so DraftWin can check
  `geometry.Get("model").GetString("bridgeVersion")` at startup.
