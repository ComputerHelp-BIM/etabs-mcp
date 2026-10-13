using System;
using System.Windows.Forms;
using EtabsBridge.Core;
using ETABSv1;

// ETABS locates the plugin class as "<Plugin Name>.cPlugin", where Plugin Name is what
// the user types in Tools > Add/Show Plugins. Keep namespace == assembly name.
namespace EtabsBridgePlugin
{
    /// <summary>
    /// ETABS plugin entry point. The class name "cPlugin" is required by ETABS.
    ///
    /// Main() opens the (modeless) ETABS Bridge window, which serves THIS ETABS
    /// instance's model over HTTP until the user clicks Stop or closes the window.
    /// ISapPlugin.Finish is called exactly once, when the window closes.
    /// </summary>
#pragma warning disable IDE1006 // ETABS requires this exact name
    public class cPlugin : cPluginContract
#pragma warning restore IDE1006
    {
        /// <summary>Text shown by ETABS in the plugin list / About box.</summary>
        public int Info(ref string Text)
        {
            Text = $"ETABS Bridge {BridgeInfo.Version} - serves this model to web apps, DraftWin and AI assistants (MCP) over a local, token-protected API.";
            return 0;
        }

        /// <summary>Called by ETABS on its UI thread when the user runs the plugin.</summary>
        public void Main(ref cSapModel SapModel, ref cPluginCallback ISapPlugin)
        {
            cPluginCallback callback = ISapPlugin;
            try
            {
                BridgeForm? running = BridgeForm.Current;
                if (running != null && !running.IsDisposed)
                {
                    // Already serving this instance: just bring the window forward.
                    running.Activate();
                    callback.Finish(0);
                    return;
                }

                var form = new BridgeForm(SapModel, callback);
                form.Show(); // modeless; the form calls Finish when it closes
            }
            catch (Exception ex)
            {
                MessageBox.Show("ETABS Bridge could not start:\n\n" + ex.Message, "ETABS Bridge", MessageBoxButtons.OK, MessageBoxIcon.Error);
                callback.Finish(1);
            }
        }
    }
}
