using System;
using System.Collections.Generic;
using System.Diagnostics;
using ETABSv1;

namespace EtabsBridge.Etabs
{
    /// <summary>A running ETABS process.</summary>
    public sealed class EtabsProcessInfo
    {
        public int ProcessId { get; set; }

        /// <summary>Main window title (usually contains the model name); may be empty.</summary>
        public string WindowTitle { get; set; } = string.Empty;
    }

    /// <summary>
    /// Out-of-process attach for external hosts (DraftWin, tools). The plugin does NOT
    /// need this: ETABS hands the plugin its own cSapModel.
    ///
    /// Prefer the bridge's HTTP API from external hosts: it works across privilege levels
    /// (an elevated ETABS cannot be attached over COM from a non-elevated DraftWin) and
    /// needs no ETABSv1 reference. Use direct attach when the plugin is not installed.
    /// </summary>
    public static class EtabsConnector
    {
        /// <summary>COM class name of the ETABS API object.</summary>
        public const string EtabsProgId = "CSI.ETABS.API.ETABSObject";

        /// <summary>Lists running ETABS.exe processes.</summary>
        public static IReadOnlyList<EtabsProcessInfo> ListRunningInstances()
        {
            var list = new List<EtabsProcessInfo>();
            foreach (Process p in Process.GetProcessesByName("ETABS"))
            {
                using (p)
                {
                    string title;
                    try
                    {
                        title = p.MainWindowTitle ?? string.Empty;
                    }
                    catch (InvalidOperationException)
                    {
                        continue; // exited meanwhile
                    }

                    list.Add(new EtabsProcessInfo { ProcessId = p.Id, WindowTitle = title });
                }
            }

            return list;
        }

        /// <summary>
        /// Attaches to the exact ETABS instance with <paramref name="processId"/>
        /// (cHelper.GetObjectProcess), unlike GetObject which returns an arbitrary instance.
        /// </summary>
        /// <exception cref="InvalidOperationException">ETABS not reachable (wrong PID, or different elevation level).</exception>
        public static cSapModel AttachByProcessId(int processId)
        {
            cHelper helper = new Helper();
            cOAPI? etabs;
            try
            {
                etabs = helper.GetObjectProcess(EtabsProgId, processId);
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException(
                    $"Could not attach to ETABS process {processId}. If ETABS runs as administrator and this program does not (or the reverse), " +
                    "COM attach is blocked; use the ETABS Bridge plugin's HTTP API instead.",
                    ex);
            }

            if (etabs == null || etabs.SapModel == null)
            {
                throw new InvalidOperationException($"ETABS process {processId} did not return an API object. Is a model open?");
            }

            return etabs.SapModel;
        }
    }
}
