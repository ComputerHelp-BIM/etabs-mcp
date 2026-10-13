using System;
using EtabsBridge.Core.Configuration;
using EtabsBridge.Core.Discovery;
using EtabsBridge.Core.Http;
using EtabsBridge.Core.Ports;

namespace EtabsBridge.Core.Hosting
{
    /// <summary>
    /// One bridge session: token + HTTP server + discovery record for one ETABS instance.
    /// Host-agnostic: the plugin uses it with the ETABS UI-thread dispatcher; another host
    /// (e.g. DraftWin attached over COM) could use it with a <see cref="SerialDispatcher"/>.
    /// </summary>
    public sealed class BridgeHost : IDisposable
    {
        private readonly IEtabsModel _model;
        private readonly IEtabsDispatcher _dispatcher;
        private readonly BridgeSettings _settings;
        private readonly int _etabsProcessId;
        private readonly InstanceRegistry _registry;
        private BridgeHttpServer? _server;
        private volatile bool _allowWrites;

        public BridgeHost(IEtabsModel model, IEtabsDispatcher dispatcher, BridgeSettings settings, int etabsProcessId, InstanceRegistry registry)
        {
            _model = model ?? throw new ArgumentNullException(nameof(model));
            _dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
            _settings = settings ?? throw new ArgumentNullException(nameof(settings));
            _etabsProcessId = etabsProcessId;
            _registry = registry ?? throw new ArgumentNullException(nameof(registry));
            Token = BridgeSecurity.CreateToken();
        }

        /// <summary>Raised for every request (on an HTTP worker thread).</summary>
        public event Action<RequestLogEntry>? RequestCompleted;

        /// <summary>Raised for transport-level errors (on an HTTP worker thread).</summary>
        public event Action<Exception>? ServerError;

        public string Token { get; }

        public bool IsRunning => _server != null;

        public int Port => _server?.Port ?? 0;

        public string BaseUrl => _server?.BaseUrl ?? string.Empty;

        /// <summary>Web app URL with the connection details in the fragment.</summary>
        public string WebAppLink => BridgeSecurity.BuildWebAppLink(_settings.WebAppUrl, BaseUrl, Token);

        /// <summary>Allows model-modifying RPC calls; takes effect for the next request.</summary>
        public bool AllowWrites
        {
            get => _allowWrites;
            set => _allowWrites = value;
        }

        /// <summary>
        /// Starts serving and registers the instance for discovery.
        /// Call on the ETABS API thread (it reads the model path for the discovery record).
        /// </summary>
        public void Start()
        {
            if (_server != null)
            {
                throw new InvalidOperationException("Bridge already started.");
            }

            // Read before binding the port so a failing API call leaves nothing running.
            RawModelInfo info = _model.GetModelInfo();

            var options = new BridgeOptions
            {
                PreferredPort = _settings.PreferredPort,
                Token = Token,
                AllowedOrigins = _settings.AllowedOrigins,
                CallTimeout = TimeSpan.FromSeconds(_settings.CallTimeoutSeconds),
                WritesEnabled = () => _allowWrites,
            };

            var api = new BridgeApi(_model, _dispatcher, options, _etabsProcessId);
            api.RequestCompleted += e => RequestCompleted?.Invoke(e);
            var server = new BridgeHttpServer(api, options);
            server.ServerError += e => ServerError?.Invoke(e);
            server.Start();
            _server = server;

            try
            {
                _registry.Register(new InstanceRecord
                {
                    ProcessId = _etabsProcessId,
                    Port = server.Port,
                    BaseUrl = server.BaseUrl,
                    Token = Token,
                    ModelPath = info.FilePath,
                    EtabsVersion = info.EtabsVersion,
                    BridgeVersion = BridgeInfo.Version,
                    StartedAt = DateTime.UtcNow.ToString("o", System.Globalization.CultureInfo.InvariantCulture),
                });
            }
            catch (Exception ex) when (ex is System.IO.IOException || ex is UnauthorizedAccessException)
            {
                // Discovery is a convenience; the bridge still works with URL + token copied by hand.
                ServerError?.Invoke(ex);
            }
        }

        public void Stop()
        {
            if (_server == null)
            {
                return;
            }

            _registry.Unregister(_etabsProcessId);
            _server.Dispose();
            _server = null;
        }

        public void Dispose() => Stop();
    }
}
