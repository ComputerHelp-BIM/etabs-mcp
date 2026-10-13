using System;
using System.Threading;
using System.Threading.Tasks;
using EtabsBridge.Core.Http;
using EtabsBridge.Core.Json;
using EtabsBridge.Core.Ports;
using EtabsBridge.Core.Tests.Fakes;
using Xunit;

namespace EtabsBridge.Core.Tests
{
    public class BridgeApiTests
    {
        internal const string Token = "test-token-0123456789abcdef";

        private readonly FakeEtabsModel _model = new FakeEtabsModel();
        private bool _writes;

        private BridgeApi CreateApi(IEtabsDispatcher? dispatcher = null, TimeSpan? timeout = null) => new BridgeApi(
            _model,
            dispatcher ?? new SerialDispatcher(),
            new BridgeOptions
            {
                Token = Token,
                AllowedOrigins = new[] { "http://localhost:5173", "https://app.example.com/" },
                CallTimeout = timeout ?? TimeSpan.FromSeconds(10),
                WritesEnabled = () => _writes,
            },
            etabsProcessId: 1234);

        private static BridgeRequest Request(string method, string path, bool auth = true, string? origin = null, string host = "localhost:52780")
        {
            int q = path.IndexOf('?');
            var request = new BridgeRequest(method, q < 0 ? path : path.Substring(0, q));
            if (q >= 0)
            {
                foreach (string pair in path.Substring(q + 1).Split('&'))
                {
                    string[] kv = pair.Split('=');
                    request.Query[Uri.UnescapeDataString(kv[0])] = kv.Length > 1 ? Uri.UnescapeDataString(kv[1]) : string.Empty;
                }
            }

            request.Headers["Host"] = host;
            if (auth)
            {
                request.Headers["Authorization"] = "Bearer " + Token;
            }

            if (origin != null)
            {
                request.Headers["Origin"] = origin;
            }

            return request;
        }

        private async Task<(BridgeResponse Response, JsonValue Json)> Send(BridgeRequest request, BridgeApi? api = null)
        {
            BridgeResponse response = await (api ?? CreateApi()).HandleAsync(request, CancellationToken.None);
            JsonValue json = response.Body == null ? JsonValue.Null : JsonParser.Parse(response.Body);
            return (response, json);
        }

        private static string ErrorCode(JsonValue json) => json.Get("error")!.GetString("code")!;

        [Fact]
        public async Task HealthNeedsNoToken()
        {
            var (response, json) = await Send(Request("GET", "/api/v1/health", auth: false));

            Assert.Equal(200, response.Status);
            Assert.Equal("ok", json.GetString("status"));
            Assert.Equal("1", json.GetString("apiVersion"));
            Assert.Equal(1234, json.GetInt64("processId"));
            Assert.Equal("no-store", response.Headers["Cache-Control"]);
            Assert.Equal(0, _model.Calls); // never touches ETABS
        }

        [Fact]
        public async Task OtherEndpointsNeedTheToken()
        {
            var (response, json) = await Send(Request("GET", "/api/v1/model", auth: false));
            Assert.Equal(401, response.Status);
            Assert.Equal(ErrorCodes.Unauthorized, ErrorCode(json));

            BridgeRequest wrong = Request("GET", "/api/v1/model", auth: false);
            wrong.Headers["Authorization"] = "Bearer " + Token + "x";
            Assert.Equal(401, (await Send(wrong)).Response.Status);

            BridgeRequest header = Request("GET", "/api/v1/model", auth: false);
            header.Headers["X-Bridge-Token"] = Token;
            Assert.Equal(200, (await Send(header)).Response.Status);
            Assert.Equal(0, _model.Calls - 1); // only the authorized request reached ETABS
        }

        [Fact]
        public async Task ModelEndpointReturnsInfo()
        {
            var (response, json) = await Send(Request("GET", "/api/v1/model"));

            Assert.Equal(200, response.Status);
            Assert.Equal("application/json; charset=utf-8", response.Headers["Content-Type"]);
            Assert.Equal("Sample.EDB", json.GetString("fileName"));
            Assert.Equal("kN_m_C", json.Get("units")!.GetString("name"));
            Assert.Equal(1234, json.GetInt64("processId"));
        }

        [Theory]
        [InlineData("/api/v1/geometry", "frames")]
        [InlineData("/api/v1/geometry/stories", "stories")]
        [InlineData("/api/v1/geometry/grids", "gridSystems")]
        [InlineData("/api/v1/geometry/joints", "joints")]
        [InlineData("/api/v1/geometry/frames", "frames")]
        [InlineData("/api/v1/geometry/areas", "areas")]
        [InlineData("/api/v1/geometry/areas/", "areas")]
        [InlineData("/api/v1/tables", "tables")]
        [InlineData("/api/v1/sections", "frameSections")]
        [InlineData("/api/v1/loads", "patterns")]
        public async Task GeometryAndTableEndpoints(string path, string arrayProperty)
        {
            var (response, json) = await Send(Request("GET", path));

            Assert.Equal(200, response.Status);
            Assert.NotEmpty(json.Get(arrayProperty)!.AsArray());
        }

        [Fact]
        public async Task TableDataSupportsPaging()
        {
            var (response, json) = await Send(Request("GET", "/api/v1/tables/data?key=Story%20Definitions&offset=1&limit=5"));

            Assert.Equal(200, response.Status);
            Assert.Equal(2, json.GetInt64("totalRows"));
            Assert.Equal(1, json.GetInt64("offset"));
            Assert.Single(json.Get("rows")!.AsArray());
            Assert.Equal("Story1", json.Get("rows")!.AsArray()[0].AsArray()[0].AsString());
            Assert.Equal("All", json.GetString("group"));
        }

        [Theory]
        [InlineData("/api/v1/tables/data")]
        [InlineData("/api/v1/tables/data?key=Story%20Definitions&limit=-1")]
        [InlineData("/api/v1/tables/data?key=Story%20Definitions&offset=x")]
        public async Task TableDataValidatesQuery(string path)
        {
            var (response, json) = await Send(Request("GET", path));
            Assert.Equal(400, response.Status);
            Assert.Equal(ErrorCodes.BadRequest, ErrorCode(json));
        }

        [Fact]
        public async Task UnknownTableIsEtabsApiError()
        {
            var (response, json) = await Send(Request("GET", "/api/v1/tables/data?key=Nope"));
            Assert.Equal(502, response.Status);
            Assert.Equal(ErrorCodes.EtabsApiError, ErrorCode(json));
        }

        [Fact]
        public async Task RpcInvokesApi()
        {
            BridgeRequest request = Request("POST", "/api/v1/rpc");
            request.Body = "{\"method\":\"FrameObj.GetSection\",\"args\":{\"Name\":\"C1\"}}";

            var (response, json) = await Send(request);

            Assert.Equal(200, response.Status);
            Assert.Equal(0, json.GetInt64("returnValue"));
            Assert.Equal("C500", json.Get("outputs")!.GetString("PropName"));
        }

        [Fact]
        public async Task RpcWritesNeedOptIn()
        {
            BridgeRequest request = Request("POST", "/api/v1/rpc");
            request.Body = "{\"method\":\"FrameObj.SetSection\",\"args\":[\"C1\",\"C600\"]}";

            var (response, json) = await Send(request);
            Assert.Equal(403, response.Status);
            Assert.Equal(ErrorCodes.WriteDisabled, ErrorCode(json));

            _writes = true;
            Assert.Equal(200, (await Send(request)).Response.Status);
        }

        [Theory]
        [InlineData("not json")]
        [InlineData("{\"args\":{}}")]
        [InlineData("")]
        public async Task RpcRejectsBadBodies(string body)
        {
            BridgeRequest request = Request("POST", "/api/v1/rpc");
            request.Body = body;
            var (response, json) = await Send(request);
            Assert.Equal(400, response.Status);
            Assert.Equal(ErrorCodes.BadRequest, ErrorCode(json));
        }

        [Fact]
        public async Task DescribeListsApi()
        {
            var (response, json) = await Send(Request("GET", "/api/v1/rpc/describe?path=FrameObj"));
            Assert.Equal(200, response.Status);
            Assert.Equal("FrameObj", json.GetString("path"));
            Assert.NotEmpty(json.Get("methods")!.AsArray());
        }

        [Fact]
        public async Task UnknownRouteAndWrongMethod()
        {
            var (notFound, nfJson) = await Send(Request("GET", "/api/v1/nope"));
            Assert.Equal(404, notFound.Status);
            Assert.Equal(ErrorCodes.NotFound, ErrorCode(nfJson));

            var (wrongMethod, wmJson) = await Send(Request("DELETE", "/api/v1/model"));
            Assert.Equal(405, wrongMethod.Status);
            Assert.Equal("GET", wrongMethod.Headers["Allow"]);
            Assert.Equal(ErrorCodes.MethodNotAllowed, ErrorCode(wmJson));
        }

        [Theory]
        [InlineData("localhost:52780", 200)]
        [InlineData("127.0.0.1:52780", 200)]
        [InlineData("[::1]:52780", 200)]
        [InlineData("LOCALHOST", 200)]
        [InlineData("evil.example.com:52780", 403)]
        [InlineData("localhost.evil.com", 403)]
        public async Task OnlyLoopbackHostsAreServed(string host, int expected)
        {
            var (response, _) = await Send(Request("GET", "/api/v1/health", host: host));
            Assert.Equal(expected, response.Status);
        }

        [Fact]
        public async Task AllowedOriginGetsCorsHeaders()
        {
            var (response, _) = await Send(Request("GET", "/api/v1/model", origin: "https://app.example.com"));

            Assert.Equal(200, response.Status);
            Assert.Equal("https://app.example.com", response.Headers["Access-Control-Allow-Origin"]);
            Assert.Equal("Origin", response.Headers["Vary"]);
        }

        [Fact]
        public async Task CorsHeadersAlsoOnAuthErrors()
        {
            var (response, _) = await Send(Request("GET", "/api/v1/model", auth: false, origin: "http://localhost:5173"));
            Assert.Equal(401, response.Status);
            Assert.Equal("http://localhost:5173", response.Headers["Access-Control-Allow-Origin"]);
        }

        [Fact]
        public async Task ForeignOriginIsRejectedBeforeEtabs()
        {
            var (response, json) = await Send(Request("GET", "/api/v1/model", origin: "https://evil.example.com"));

            Assert.Equal(403, response.Status);
            Assert.Equal(ErrorCodes.ForbiddenOrigin, ErrorCode(json));
            Assert.False(response.Headers.ContainsKey("Access-Control-Allow-Origin"));
            Assert.Equal(0, _model.Calls);
        }

        [Fact]
        public async Task PreflightSucceedsWithoutToken()
        {
            BridgeRequest request = Request("OPTIONS", "/api/v1/model", auth: false, origin: "http://localhost:5173");
            request.Headers["Access-Control-Request-Private-Network"] = "true";

            var (response, _) = await Send(request);

            Assert.Equal(204, response.Status);
            Assert.Null(response.Body);
            Assert.Contains("Authorization", response.Headers["Access-Control-Allow-Headers"]);
            Assert.Equal("true", response.Headers["Access-Control-Allow-Private-Network"]);
        }

        [Fact]
        public async Task EtabsFailuresMapTo502()
        {
            _model.Failure = new EtabsApiException("FrameObj.GetAllFrames", 1);
            var (response, json) = await Send(Request("GET", "/api/v1/geometry/frames"));

            Assert.Equal(502, response.Status);
            Assert.Equal(ErrorCodes.EtabsApiError, ErrorCode(json));
            Assert.Contains("FrameObj.GetAllFrames", json.Get("error")!.GetString("message"));
        }

        [Fact]
        public async Task UnexpectedFailuresMapTo500()
        {
            _model.Failure = new NullReferenceException("oops");
            var (response, json) = await Send(Request("GET", "/api/v1/model"));
            Assert.Equal(500, response.Status);
            Assert.Equal(ErrorCodes.Internal, ErrorCode(json));
        }

        [Fact]
        public async Task BusyEtabsTimesOutWith503()
        {
            var api = CreateApi(new NeverRunsDispatcher(), TimeSpan.FromMilliseconds(50));
            var (response, json) = await Send(Request("GET", "/api/v1/model"), api);

            Assert.Equal(503, response.Status);
            Assert.Equal(ErrorCodes.EtabsBusy, ErrorCode(json));
        }

        [Fact]
        public async Task RaisesRequestLog()
        {
            BridgeApi api = CreateApi();
            RequestLogEntry? entry = null;
            api.RequestCompleted += e => entry = e;
            api.RequestCompleted += e => throw new InvalidOperationException("bad handler is ignored");

            await Send(Request("GET", "/api/v1/model", auth: false), api);

            Assert.NotNull(entry);
            Assert.Equal(401, entry!.Status);
            Assert.Equal("/api/v1/model", entry.Path);
            Assert.NotNull(entry.Error);
        }

        [Fact]
        public void RequiresStrongToken()
        {
            Assert.Throws<ArgumentException>(() => new BridgeApi(_model, new SerialDispatcher(), new BridgeOptions { Token = "short" }, 1));
        }

        /// <summary>Simulates an ETABS UI thread blocked by a modal dialog.</summary>
        private sealed class NeverRunsDispatcher : IEtabsDispatcher
        {
            public Task<T> InvokeAsync<T>(Func<T> work, CancellationToken cancellationToken)
            {
                var tcs = new TaskCompletionSource<T>();
                cancellationToken.Register(() => tcs.TrySetCanceled());
                return tcs.Task;
            }
        }
    }
}
