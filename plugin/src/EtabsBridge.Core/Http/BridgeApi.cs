using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using EtabsBridge.Core.Json;
using EtabsBridge.Core.Model;
using EtabsBridge.Core.Ports;
using EtabsBridge.Core.Rpc;
using EtabsBridge.Core.Services;

namespace EtabsBridge.Core.Http
{
    /// <summary>
    /// The REST API: security checks (host, origin, token), routing, and mapping of
    /// results/errors to JSON. Transport-independent; <see cref="BridgeHttpServer"/>
    /// feeds it from HttpListener and tests call <see cref="HandleAsync"/> directly.
    ///
    /// Routes (all under /api/v1):
    ///   GET  /health                 no auth; liveness + versions
    ///   GET  /model                  model info + present units
    ///   GET  /geometry               full snapshot (stories, grids, joints, frames, areas)
    ///   GET  /geometry/{stories|grids|joints|frames|areas}
    ///   GET  /sections               materials, frame sections, area sections (0.2.0)
    ///   GET  /loads                  patterns, cases, combinations, assigned loads (0.5.0)
    ///   GET  /results/status         analysis status of every case, combination names (0.6.0)
    ///   GET  /results/{base-reactions|story-drifts|joint-reactions|joint-displacements|frame-forces}
    ///        ?cases=A,B&amp;combos=C[&amp;joint=|frame=][&amp;offset=&amp;limit=]
    ///   GET  /design/concrete        required reinforcement from concrete frame design (0.6.0)
    ///   GET  /tables                 database table catalogue
    ///   GET  /tables/data?key=..&amp;group=All&amp;fields=a,b&amp;offset=0&amp;limit=1000
    ///   GET  /rpc/describe?path=FrameObj
    ///   POST /rpc                    {"method":"FrameObj.GetSection","args":{"Name":"C1"}}
    /// </summary>
    public sealed class BridgeApi
    {
        private const string JsonContentType = "application/json; charset=utf-8";

        private readonly IEtabsModel _model;
        private readonly IEtabsDispatcher _dispatcher;
        private readonly BridgeOptions _options;
        private readonly int _etabsProcessId;
        private readonly GeometryService _geometry;
        private readonly ApiInvoker _invoker;
        private readonly Dictionary<string, Dictionary<string, Func<BridgeRequest, CancellationToken, Task<object>>>> _routes;
        private readonly byte[] _tokenBytes;
        private readonly OriginMatcher _origins;

        public BridgeApi(IEtabsModel model, IEtabsDispatcher dispatcher, BridgeOptions options, int etabsProcessId)
        {
            _model = model ?? throw new ArgumentNullException(nameof(model));
            _dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
            _options = options ?? throw new ArgumentNullException(nameof(options));
            if (string.IsNullOrEmpty(options.Token) || options.Token.Length < 16)
            {
                throw new ArgumentException("A token of at least 16 characters is required.", nameof(options));
            }

            _etabsProcessId = etabsProcessId;
            _tokenBytes = Encoding.UTF8.GetBytes(options.Token);
            _origins = new OriginMatcher(options.AllowedOrigins);
            _geometry = new GeometryService(model, etabsProcessId);
            _invoker = new ApiInvoker(model.ApiRoot, model.ApiRootType, () => options.WritesEnabled());
            _routes = BuildRoutes();
        }

        /// <summary>Raised after each request completes. Handlers must be fast and must not throw.</summary>
        public event Action<RequestLogEntry>? RequestCompleted;

        public async Task<BridgeResponse> HandleAsync(BridgeRequest request, CancellationToken cancellationToken)
        {
            var stopwatch = Stopwatch.StartNew();
            var response = new BridgeResponse();
            string? error = null;
            try
            {
                await HandleCoreAsync(request, response, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                error = ex.Message;
                WriteError(response, ex);
            }

            response.Headers["Cache-Control"] = "no-store";
            response.Headers["X-Content-Type-Options"] = "nosniff";
            if (response.Body != null)
            {
                response.Headers["Content-Type"] = JsonContentType;
            }

            Log(request, response, stopwatch.ElapsedMilliseconds, error);
            return response;
        }

        private async Task HandleCoreAsync(BridgeRequest request, BridgeResponse response, CancellationToken cancellationToken)
        {
            CheckHost(request);
            ApplyCors(request, response);

            if (request.Method == "OPTIONS")
            {
                response.Status = 204; // CORS preflight; headers already applied
                return;
            }

            string path = request.Path.Length > 1 ? request.Path.TrimEnd('/') : request.Path;
            if (!_routes.TryGetValue(path, out Dictionary<string, Func<BridgeRequest, CancellationToken, Task<object>>>? byMethod))
            {
                throw new BridgeException(404, ErrorCodes.NotFound, $"No endpoint at '{request.Path}'. See {BridgeInfo.ApiPrefix}/health.");
            }

            if (!byMethod.TryGetValue(request.Method, out Func<BridgeRequest, CancellationToken, Task<object>>? handler))
            {
                response.Headers["Allow"] = string.Join(", ", byMethod.Keys);
                throw new BridgeException(405, ErrorCodes.MethodNotAllowed, $"{request.Method} is not supported on '{path}'.");
            }

            if (path != BridgeInfo.ApiPrefix + "/health")
            {
                Authenticate(request);
            }

            object result = await handler(request, cancellationToken).ConfigureAwait(false);
            response.Status = 200;
            response.Body = JsonSerializer.Serialize(result);
        }

        private Dictionary<string, Dictionary<string, Func<BridgeRequest, CancellationToken, Task<object>>>> BuildRoutes()
        {
            var routes = new Dictionary<string, Dictionary<string, Func<BridgeRequest, CancellationToken, Task<object>>>>(StringComparer.Ordinal);

            void Get(string route, Func<BridgeRequest, CancellationToken, Task<object>> h) => Add(routes, "GET", route, h);

            Get("/health", (r, ct) => Task.FromResult<object>(new
            {
                Status = "ok",
                BridgeVersion = BridgeInfo.Version,
                ApiVersion = BridgeInfo.ApiVersion,
                ProcessId = _etabsProcessId,
            }));
            Get("/model", (r, ct) => OnEtabs(() => (object)_geometry.GetModelInfo(), ct));
            Get("/geometry", (r, ct) => OnEtabs(() => (object)_geometry.GetSnapshot(), ct));
            Get("/geometry/stories", (r, ct) => OnEtabs(() => (object)_geometry.GetStories(), ct));
            Get("/geometry/grids", (r, ct) => OnEtabs(() => (object)_geometry.GetGrids(), ct));
            Get("/geometry/joints", (r, ct) => OnEtabs(() => (object)_geometry.GetJoints(), ct));
            Get("/geometry/frames", (r, ct) => OnEtabs(() => (object)_geometry.GetFrames(), ct));
            Get("/geometry/areas", (r, ct) => OnEtabs(() => (object)_geometry.GetAreas(), ct));
            Get("/sections", (r, ct) => OnEtabs(() => (object)new SectionService(_model).GetSections(), ct));
            Get("/loads", (r, ct) => OnEtabs(() => (object)new LoadsService(_model).GetLoads(), ct));
            Get("/results/status", (r, ct) => OnEtabs(() => (object)new ResultsService(_model).GetStatus(), ct));
            Get("/results/base-reactions", (r, ct) => Results(r, ct, (svc, sel) => svc.GetBaseReactions(sel)));
            Get("/results/story-drifts", (r, ct) => Results(r, ct, (svc, sel) => svc.GetStoryDrifts(sel)));
            Get("/results/joint-reactions", (r, ct) => Results(r, ct, (svc, sel) => svc.GetJointReactions(sel, Optional(r, "joint"))));
            Get("/results/joint-displacements", (r, ct) => Results(r, ct, (svc, sel) => svc.GetJointDisplacements(sel, Optional(r, "joint"))));
            Get("/results/frame-forces", (r, ct) => Results(r, ct, (svc, sel) => svc.GetFrameForces(sel, Optional(r, "frame"))));
            Get("/design/concrete", (r, ct) => Paged(r, ct, () => new ResultsService(_model).GetConcreteDesign()));
            Get("/tables", (r, ct) => OnEtabs(() => (object)new TablesResult { Tables = _model.GetTables() }, ct));
            Get("/tables/data", GetTableAsync);
            Get("/rpc/describe", (r, ct) => OnEtabs(() => (object)_invoker.Describe(r.QueryValue("path")), ct));
            Add(routes, "POST", "/rpc", InvokeRpcAsync);
            return routes;
        }

        private static void Add(
            Dictionary<string, Dictionary<string, Func<BridgeRequest, CancellationToken, Task<object>>>> routes,
            string method,
            string route,
            Func<BridgeRequest, CancellationToken, Task<object>> handler)
        {
            string path = BridgeInfo.ApiPrefix + route;
            if (!routes.TryGetValue(path, out Dictionary<string, Func<BridgeRequest, CancellationToken, Task<object>>>? byMethod))
            {
                byMethod = new Dictionary<string, Func<BridgeRequest, CancellationToken, Task<object>>>(StringComparer.Ordinal);
                routes[path] = byMethod;
            }

            byMethod[method] = handler;
        }

        private Task<object> GetTableAsync(BridgeRequest request, CancellationToken ct)
        {
            string key = request.QueryValue("key") ?? string.Empty;
            if (key.Trim().Length == 0)
            {
                throw new BridgeException(400, ErrorCodes.BadRequest, "Query parameter 'key' is required. Get keys from /tables.");
            }

            string group = string.IsNullOrWhiteSpace(request.QueryValue("group")) ? "All" : request.QueryValue("group")!;
            string[] fields = (request.QueryValue("fields") ?? string.Empty)
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(f => f.Trim())
                .Where(f => f.Length > 0)
                .ToArray();
            int offset = ParseNonNegative(request, "offset", 0);
            int limit = ParseNonNegative(request, "limit", int.MaxValue);

            return OnEtabs(
                () =>
                {
                    TableData table = _model.GetTable(key, group, fields);
                    table.TotalRows = table.Rows.Count;
                    table.Offset = Math.Min(offset, table.Rows.Count);
                    if (offset > 0 || limit < table.Rows.Count)
                    {
                        table.Rows = table.Rows.Skip(offset).Take(limit).ToList();
                    }

                    return (object)table;
                },
                ct);
        }

        private Task<object> Results<T>(BridgeRequest request, CancellationToken ct, Func<ResultsService, OutputSelection, ResultRows<T>> read)
        {
            var selection = new OutputSelection { Cases = List(request, "cases"), Combinations = List(request, "combos") };
            if (selection.IsEmpty)
            {
                throw new BridgeException(400, ErrorCodes.BadRequest, "Select at least one load case (cases=...) or combination (combos=...). See /results/status.");
            }

            return Paged(request, ct, () => read(new ResultsService(_model), selection));
        }

        /// <summary>Runs a result read on the ETABS thread and applies offset/limit paging.</summary>
        private Task<object> Paged<T>(BridgeRequest request, CancellationToken ct, Func<ResultRows<T>> read)
        {
            int offset = ParseNonNegative(request, "offset", 0);
            int limit = ParseNonNegative(request, "limit", int.MaxValue);
            return OnEtabs(
                () =>
                {
                    ResultRows<T> rows = read();
                    rows.TotalRows = rows.Rows.Count;
                    rows.Offset = Math.Min(offset, rows.Rows.Count);
                    if (offset > 0 || limit < rows.Rows.Count)
                    {
                        rows.Rows = rows.Rows.Skip(offset).Take(limit).ToList();
                    }

                    return (object)rows;
                },
                ct);
        }

        /// <summary>Comma-separated query list ("cases=Dead,Live"), trimmed, empty entries removed.</summary>
        private static IReadOnlyList<string> List(BridgeRequest request, string name) =>
            (request.QueryValue(name) ?? string.Empty)
                .Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries)
                .Select(x => x.Trim())
                .Where(x => x.Length > 0)
                .Distinct(StringComparer.Ordinal)
                .ToList();

        private static string? Optional(BridgeRequest request, string name)
        {
            string? v = request.QueryValue(name)?.Trim();
            return string.IsNullOrEmpty(v) ? null : v;
        }

        private Task<object> InvokeRpcAsync(BridgeRequest request, CancellationToken ct)
        {
            JsonValue body;
            try
            {
                body = JsonParser.Parse(request.Body);
            }
            catch (JsonParseException ex)
            {
                throw new BridgeException(400, ErrorCodes.BadRequest, "Request body is not valid JSON: " + ex.Message);
            }

            string? method = body.GetString("method");
            if (string.IsNullOrWhiteSpace(method))
            {
                throw new BridgeException(400, ErrorCodes.BadRequest, "Body must be {\"method\": \"FrameObj.GetSection\", \"args\": {...}}.");
            }

            JsonValue? args = body.Get("args");
            return OnEtabs(() => (object)_invoker.Invoke(method!, args), ct);
        }

        /// <summary>Runs ETABS work on the API thread with the configured timeout.</summary>
        private async Task<object> OnEtabs(Func<object> work, CancellationToken requestAborted)
        {
            using (var timeout = new CancellationTokenSource(_options.CallTimeout))
            using (var linked = CancellationTokenSource.CreateLinkedTokenSource(timeout.Token, requestAborted))
            {
                try
                {
                    return await _dispatcher.InvokeAsync(work, linked.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (timeout.IsCancellationRequested)
                {
                    throw new BridgeException(
                        503,
                        ErrorCodes.EtabsBusy,
                        $"ETABS did not respond within {_options.CallTimeout.TotalSeconds:0} s. Close any open ETABS dialog and retry.");
                }
            }
        }

        private static int ParseNonNegative(BridgeRequest request, string name, int fallback)
        {
            string? raw = request.QueryValue(name);
            if (string.IsNullOrEmpty(raw))
            {
                return fallback;
            }

            if (!int.TryParse(raw, NumberStyles.None, CultureInfo.InvariantCulture, out int value))
            {
                throw new BridgeException(400, ErrorCodes.BadRequest, $"Query parameter '{name}' must be a non-negative integer.");
            }

            return value;
        }

        /// <summary>Blocks DNS-rebinding: only loopback host names are served.</summary>
        private static void CheckHost(BridgeRequest request)
        {
            string? host = request.Header("Host");
            if (string.IsNullOrEmpty(host))
            {
                return;
            }

            string name = host!;
            if (name.StartsWith("[", StringComparison.Ordinal))
            {
                int close = name.IndexOf(']');
                name = close > 0 ? name.Substring(0, close + 1) : name;
            }
            else
            {
                int colon = name.LastIndexOf(':');
                name = colon >= 0 ? name.Substring(0, colon) : name;
            }

            if (!name.Equals("localhost", StringComparison.OrdinalIgnoreCase) && name != "127.0.0.1" && name != "[::1]")
            {
                throw new BridgeException(403, ErrorCodes.ForbiddenHost, "The bridge only serves requests addressed to localhost.");
            }
        }

        private void ApplyCors(BridgeRequest request, BridgeResponse response)
        {
            string? origin = request.Header("Origin");
            if (string.IsNullOrEmpty(origin))
            {
                return; // not a browser cross-origin request
            }

            bool allowed = _origins.IsAllowed(origin);
            if (!allowed)
            {
                throw new BridgeException(
                    403,
                    ErrorCodes.ForbiddenOrigin,
                    $"Origin '{origin}' is not allowed. Add it to allowedOrigins in the ETABS Bridge settings.");
            }

            response.Headers["Access-Control-Allow-Origin"] = origin!;
            response.Headers["Vary"] = "Origin";
            response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
            response.Headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Bridge-Token";
            response.Headers["Access-Control-Max-Age"] = "600";

            // Chrome Private Network Access: a public site calling localhost must be explicitly allowed.
            if (string.Equals(request.Header("Access-Control-Request-Private-Network"), "true", StringComparison.OrdinalIgnoreCase))
            {
                response.Headers["Access-Control-Allow-Private-Network"] = "true";
            }
        }

        private void Authenticate(BridgeRequest request)
        {
            string? presented = request.Header("X-Bridge-Token");
            string? authorization = request.Header("Authorization");
            if (presented == null && authorization != null && authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                presented = authorization.Substring("Bearer ".Length).Trim();
            }

            if (presented == null || !FixedTimeEquals(Encoding.UTF8.GetBytes(presented), _tokenBytes))
            {
                throw new BridgeException(401, ErrorCodes.Unauthorized, "Missing or invalid token. Send 'Authorization: Bearer <token>' from the ETABS Bridge window.");
            }
        }

        private static bool FixedTimeEquals(byte[] a, byte[] b)
        {
            int diff = a.Length ^ b.Length;
            for (int i = 0; i < a.Length && i < b.Length; i++)
            {
                diff |= a[i] ^ b[i];
            }

            return diff == 0;
        }

        private static void WriteError(BridgeResponse response, Exception ex)
        {
            int status;
            string code;
            string message = ex.Message;
            switch (ex)
            {
                case BridgeException be:
                    status = be.Status;
                    code = be.Code;
                    break;
                case EtabsApiException _:
                    status = 502;
                    code = ErrorCodes.EtabsApiError;
                    break;
                default:
                    status = 500;
                    code = ErrorCodes.Internal;
                    message = "Unexpected error: " + ex.Message;
                    break;
            }

            response.Status = status;
            response.Body = JsonSerializer.Serialize(new Dictionary<string, object>
            {
                ["error"] = new Dictionary<string, object> { ["code"] = code, ["message"] = message },
            });
        }

        private void Log(BridgeRequest request, BridgeResponse response, long elapsedMs, string? error)
        {
            Action<RequestLogEntry>? handler = RequestCompleted;
            if (handler == null)
            {
                return;
            }

            try
            {
                handler(new RequestLogEntry
                {
                    Timestamp = DateTime.Now,
                    Method = request.Method,
                    Path = request.Path,
                    Status = response.Status,
                    DurationMs = elapsedMs,
                    Error = error,
                });
            }
            catch
            {
                // Logging must never break a response.
            }
        }
    }
}
