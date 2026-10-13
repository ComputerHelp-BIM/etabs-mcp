using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.Windows.Forms;
using EtabsBridge.Core;
using EtabsBridge.Core.Configuration;
using EtabsBridge.Core.Discovery;
using EtabsBridge.Core.Hosting;
using EtabsBridge.Core.Http;
using EtabsBridge.Core.Ports;
using EtabsBridge.Etabs;
using ETABSv1;

namespace EtabsBridgePlugin
{
    /// <summary>
    /// The plugin window: shows connection details, the request log, the write switch,
    /// and owns the <see cref="BridgeHost"/> lifetime. Built in code (no designer file)
    /// so the whole UI is reviewable in one place.
    /// </summary>
    internal sealed class BridgeForm : Form
    {
        private const int MaxLogLines = 300;

        private readonly cSapModel _sapModel;
        private readonly cPluginCallback _callback;
        private BridgeHost? _host;
        private bool _finished;

        private readonly Label _status = new Label { AutoSize = true, Font = new Font(SystemFonts.MessageBoxFont ?? Control.DefaultFont, FontStyle.Bold) };
        private readonly Label _model = new Label { AutoSize = true };
        private readonly TextBox _url = new TextBox { ReadOnly = true, Width = 300 };
        private readonly TextBox _token = new TextBox { ReadOnly = true, Width = 300, UseSystemPasswordChar = true };
        private readonly CheckBox _showToken = new CheckBox { Text = "Show", AutoSize = true };
        private readonly CheckBox _allowWrites = new CheckBox { Text = "Allow write operations (API calls may modify the model)", AutoSize = true };
        private readonly ListBox _log = new ListBox { Dock = DockStyle.Fill, IntegralHeight = false, HorizontalScrollbar = true };

        public BridgeForm(cSapModel sapModel, cPluginCallback callback)
        {
            _sapModel = sapModel ?? throw new ArgumentNullException(nameof(sapModel));
            _callback = callback ?? throw new ArgumentNullException(nameof(callback));
            Current = this;
            BuildLayout();
        }

        /// <summary>The open window for this ETABS process, if any.</summary>
        public static BridgeForm? Current { get; private set; }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            try
            {
                StartBridge();
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "ETABS Bridge could not start:\n\n" + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                Finish(1);
                Close();
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            base.OnFormClosing(e);
            if (!e.Cancel)
            {
                StopBridge();
                Finish(0);
                if (Current == this)
                {
                    Current = null;
                }
            }
        }

        private void StartBridge()
        {
            string settingsPath = BridgeSettings.DefaultPath();
            BridgeSettings settings = BridgeSettings.Load(settingsPath, out string? warning);
            if (warning != null)
            {
                AppendLog("Settings: " + warning);
            }

            // This form's handle exists (OnShown), so WindowsFormsSynchronizationContext
            // marshals onto the ETABS UI thread through this thread's message pump.
            var dispatcher = new SynchronizationContextDispatcher(new WindowsFormsSynchronizationContext());
            int pid = Process.GetCurrentProcess().Id;

            _host = new BridgeHost(new EtabsApiModel(_sapModel), dispatcher, settings, pid, new InstanceRegistry());
            _host.RequestCompleted += entry => BeginInvokeSafe(() => AppendLog(FormatEntry(entry)));
            _host.ServerError += ex => BeginInvokeSafe(() => AppendLog("Server: " + ex.Message));
            _host.Start();

            string modelPath = _sapModel.GetModelFilename(true);
            _model.Text = string.IsNullOrEmpty(modelPath) ? "Model: (unsaved)" : "Model: " + modelPath;
            _url.Text = _host.BaseUrl;
            _token.Text = _host.Token;
            _status.Text = $"Serving on {_host.BaseUrl}  (bridge {BridgeInfo.Version}, ETABS process {pid})";
            _status.ForeColor = Color.DarkGreen;
            AppendLog($"Started. Settings: {settingsPath}");
            AppendLog("Allowed browser origins: " + string.Join(", ", settings.AllowedOrigins));
        }

        private void StopBridge()
        {
            if (_host == null)
            {
                return;
            }

            _host.Dispose();
            _host = null;
            _status.Text = "Stopped";
            _status.ForeColor = Color.DarkRed;
        }

        /// <summary>Tells ETABS the plugin is done. Must happen exactly once.</summary>
        private void Finish(int code)
        {
            if (_finished)
            {
                return;
            }

            _finished = true;
            try
            {
                _callback.Finish(code);
            }
            catch
            {
                // ETABS may already be shutting down.
            }
        }

        private void BuildLayout()
        {
            Text = "ETABS Bridge";
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(640, 460);
            MinimumSize = new Size(560, 380);
            ShowInTaskbar = true;

            var copyUrl = new Button { Text = "Copy", AutoSize = true };
            copyUrl.Click += (s, e) => CopyToClipboard(_url.Text);
            var copyToken = new Button { Text = "Copy", AutoSize = true };
            copyToken.Click += (s, e) => CopyToClipboard(_token.Text);
            _showToken.CheckedChanged += (s, e) => _token.UseSystemPasswordChar = !_showToken.Checked;

            var openWeb = new Button { Text = "Open web app", AutoSize = true };
            openWeb.Click += (s, e) => OpenWebApp();
            var copyJson = new Button { Text = "Copy connection JSON", AutoSize = true };
            copyJson.Click += (s, e) =>
            {
                if (_host != null)
                {
                    CopyToClipboard("{\"bridgeUrl\":\"" + _host.BaseUrl + "\",\"token\":\"" + _host.Token + "\"}");
                }
            };
            var stop = new Button { Text = "Stop and return to ETABS", AutoSize = true };
            stop.Click += (s, e) => Close();

            _allowWrites.CheckedChanged += OnAllowWritesChanged;

            var grid = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 4, Padding = new Padding(8) };
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

            grid.Controls.Add(_status, 0, 0);
            grid.SetColumnSpan(_status, 4);
            grid.Controls.Add(_model, 0, 1);
            grid.SetColumnSpan(_model, 4);

            grid.Controls.Add(new Label { Text = "URL", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 2);
            _url.Anchor = AnchorStyles.Left | AnchorStyles.Right;
            grid.Controls.Add(_url, 1, 2);
            grid.Controls.Add(copyUrl, 2, 2);

            grid.Controls.Add(new Label { Text = "Token", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 3);
            _token.Anchor = AnchorStyles.Left | AnchorStyles.Right;
            grid.Controls.Add(_token, 1, 3);
            grid.Controls.Add(copyToken, 2, 3);
            grid.Controls.Add(_showToken, 3, 3);

            var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true };
            actions.Controls.Add(openWeb);
            actions.Controls.Add(copyJson);
            grid.Controls.Add(actions, 0, 4);
            grid.SetColumnSpan(actions, 4);

            grid.Controls.Add(_allowWrites, 0, 5);
            grid.SetColumnSpan(_allowWrites, 4);

            var logGroup = new GroupBox { Text = "Requests", Dock = DockStyle.Fill, Padding = new Padding(8) };
            logGroup.Controls.Add(_log);

            var bottom = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(8) };
            bottom.Controls.Add(stop);

            Controls.Add(logGroup);
            Controls.Add(bottom);
            Controls.Add(grid);
        }

        private void OnAllowWritesChanged(object? sender, EventArgs e)
        {
            if (_host == null)
            {
                return;
            }

            if (_allowWrites.Checked)
            {
                DialogResult answer = MessageBox.Show(
                    this,
                    "Connected clients will be able to call ANY ETABS API method, including ones that change, delete or save model data.\n\n" +
                    "Only enable this for clients you trust, and keep a backup of the model.\n\nEnable write operations?",
                    Text,
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning,
                    MessageBoxDefaultButton.Button2);
                if (answer != DialogResult.Yes)
                {
                    _allowWrites.CheckedChanged -= OnAllowWritesChanged;
                    _allowWrites.Checked = false;
                    _allowWrites.CheckedChanged += OnAllowWritesChanged;
                    return;
                }
            }

            _host.AllowWrites = _allowWrites.Checked;
            AppendLog(_allowWrites.Checked ? "Write operations ENABLED." : "Write operations disabled.");
        }

        private void OpenWebApp()
        {
            if (_host == null)
            {
                return;
            }

            try
            {
                Process.Start(new ProcessStartInfo(_host.WebAppLink) { UseShellExecute = true });
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Could not open the browser: " + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void CopyToClipboard(string text)
        {
            if (string.IsNullOrEmpty(text))
            {
                return;
            }

            try
            {
                Clipboard.SetText(text);
            }
            catch (System.Runtime.InteropServices.ExternalException ex)
            {
                AppendLog("Clipboard busy: " + ex.Message);
            }
        }

        private void BeginInvokeSafe(Action action)
        {
            if (IsDisposed || !IsHandleCreated)
            {
                return;
            }

            try
            {
                BeginInvoke(action);
            }
            catch (InvalidOperationException)
            {
                // Window closed between the check and the call.
            }
        }

        private void AppendLog(string line)
        {
            _log.Items.Add(DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + "  " + line);
            while (_log.Items.Count > MaxLogLines)
            {
                _log.Items.RemoveAt(0);
            }

            _log.TopIndex = Math.Max(0, _log.Items.Count - 1);
        }

        private static string FormatEntry(RequestLogEntry e) =>
            string.Format(
                CultureInfo.InvariantCulture,
                "{0} {1} -> {2} ({3} ms){4}",
                e.Method,
                e.Path,
                e.Status,
                e.DurationMs,
                e.Error == null ? string.Empty : "  " + e.Error);
    }
}
