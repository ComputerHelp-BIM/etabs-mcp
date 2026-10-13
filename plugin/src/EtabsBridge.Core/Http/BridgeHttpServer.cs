using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace EtabsBridge.Core.Http
{
    /// <summary>
    /// Serves a <see cref="BridgeApi"/> on http://localhost:{port}/ using HttpListener
    /// (in-box on .NET Framework 4.8 and .NET 8, so no dependencies in the ETABS process).
    ///
    /// Only the "localhost" prefix is registered: it needs no admin rights or URL ACL,
    /// and http.sys does not accept connections addressed to other host names.
    /// </summary>
    public sealed class BridgeHttpServer : IDisposable
    {
        /// <summary>Oversized bodies up to this size are read and discarded so the 413 reaches the client.</summary>
        private const long MaxDrainBytes = 8L * 1024 * 1024;

        private readonly BridgeApi _api;
        private readonly BridgeOptions _options;
        private readonly CancellationTokenSource _stopping = new CancellationTokenSource();
        private HttpListener? _listener;
        private Task? _acceptLoop;

        public BridgeHttpServer(BridgeApi api, BridgeOptions options)
        {
            _api = api ?? throw new ArgumentNullException(nameof(api));
            _options = options ?? throw new ArgumentNullException(nameof(options));
        }

        /// <summary>Port in use after <see cref="Start"/>.</summary>
        public int Port { get; private set; }

        /// <summary>e.g. "http://localhost:52780".</summary>
        public string BaseUrl => "http://localhost:" + Port.ToString(CultureInfo.InvariantCulture);

        /// <summary>Raised when the accept loop hits an unexpected error (the server keeps running).</summary>
        public event Action<Exception>? ServerError;

        /// <summary>Binds the first free port in the configured range and starts serving.</summary>
        public void Start()
        {
            if (_listener != null)
            {
                throw new InvalidOperationException("Server already started.");
            }

            var failures = new List<string>();
            for (int i = 0; i < Math.Max(1, _options.PortRange); i++)
            {
                int port = _options.PreferredPort + i;
                var listener = new HttpListener();
                listener.Prefixes.Add($"http://localhost:{port.ToString(CultureInfo.InvariantCulture)}/");
                try
                {
                    listener.Start();
                }
                catch (HttpListenerException ex)
                {
                    failures.Add($"{port}: {ex.Message}");
                    listener.Close();
                    continue;
                }

                _listener = listener;
                Port = port;
                _acceptLoop = Task.Run(AcceptLoopAsync);
                return;
            }

            throw new InvalidOperationException(
                $"No free port in {_options.PreferredPort}-{_options.PreferredPort + _options.PortRange - 1}. " + string.Join("; ", failures));
        }

        public void Stop()
        {
            if (_listener == null)
            {
                return;
            }

            _stopping.Cancel();
            try
            {
                _listener.Stop();
                _listener.Close();
            }
            catch (ObjectDisposedException)
            {
            }

            try
            {
                _acceptLoop?.Wait(TimeSpan.FromSeconds(2));
            }
            catch (AggregateException)
            {
            }

            _listener = null;
        }

        public void Dispose()
        {
            Stop();
            _stopping.Dispose();
        }

        private async Task AcceptLoopAsync()
        {
            HttpListener listener = _listener!;
            while (!_stopping.IsCancellationRequested)
            {
                HttpListenerContext context;
                try
                {
                    context = await listener.GetContextAsync().ConfigureAwait(false);
                }
                catch (Exception) when (_stopping.IsCancellationRequested)
                {
                    return; // Stop() closed the listener
                }
                catch (HttpListenerException ex)
                {
                    ServerError?.Invoke(ex);
                    continue;
                }
                catch (ObjectDisposedException)
                {
                    return;
                }

                // Handle concurrently; ETABS work is serialized by the dispatcher anyway.
                _ = Task.Run(() => ProcessAsync(context));
            }
        }

        private async Task ProcessAsync(HttpListenerContext context)
        {
            try
            {
                BridgeResponse response;
                BridgeRequest? request = await ReadRequestAsync(context.Request).ConfigureAwait(false);
                if (request == null)
                {
                    response = new BridgeResponse
                    {
                        Status = 413,
                        Body = "{\"error\":{\"code\":\"" + ErrorCodes.PayloadTooLarge + "\",\"message\":\"Request body too large.\"}}",
                    };
                    response.Headers["Content-Type"] = "application/json; charset=utf-8";
                }
                else
                {
                    response = await _api.HandleAsync(request, _stopping.Token).ConfigureAwait(false);
                }

                await WriteResponseAsync(context.Response, response).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                // Client disconnected mid-response or similar; nothing useful to send back.
                ServerError?.Invoke(ex);
                try
                {
                    context.Response.Abort();
                }
                catch
                {
                }
            }
        }

        private async Task<BridgeRequest?> ReadRequestAsync(HttpListenerRequest raw)
        {
            var request = new BridgeRequest(raw.HttpMethod, raw.Url?.AbsolutePath ?? "/");
            foreach (string? key in raw.QueryString.AllKeys)
            {
                if (key != null)
                {
                    request.Query[key] = raw.QueryString[key] ?? string.Empty;
                }
            }

            foreach (string? key in raw.Headers.AllKeys)
            {
                if (key != null)
                {
                    request.Headers[key] = raw.Headers[key] ?? string.Empty;
                }
            }

            if (!raw.HasEntityBody)
            {
                return request;
            }

            if (raw.ContentLength64 > MaxDrainBytes)
            {
                return null; // far too large: answer 413 without reading
            }

            using (var buffer = new MemoryStream())
            {
                byte[] chunk = new byte[16 * 1024];
                long total = 0;
                int read;
                while ((read = await raw.InputStream.ReadAsync(chunk, 0, chunk.Length).ConfigureAwait(false)) > 0)
                {
                    total += read;
                    if (total > MaxDrainBytes)
                    {
                        return null;
                    }

                    // Past the limit, keep draining (discarding) so the client gets a clean 413
                    // instead of a connection reset while it is still sending.
                    if (total <= _options.MaxBodyBytes)
                    {
                        buffer.Write(chunk, 0, read);
                    }
                }

                if (total > _options.MaxBodyBytes)
                {
                    return null;
                }

                request.Body = Encoding.UTF8.GetString(buffer.ToArray());
            }

            return request;
        }

        private static async Task WriteResponseAsync(HttpListenerResponse raw, BridgeResponse response)
        {
            raw.StatusCode = response.Status;
            foreach (KeyValuePair<string, string> header in response.Headers)
            {
                if (string.Equals(header.Key, "Content-Type", StringComparison.OrdinalIgnoreCase))
                {
                    raw.ContentType = header.Value;
                }
                else
                {
                    raw.Headers[header.Key] = header.Value;
                }
            }

            if (response.Body == null)
            {
                raw.ContentLength64 = 0;
                raw.Close();
                return;
            }

            byte[] bytes = new UTF8Encoding(false).GetBytes(response.Body);
            raw.ContentLength64 = bytes.Length;
            await raw.OutputStream.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
            raw.Close();
        }
    }
}
