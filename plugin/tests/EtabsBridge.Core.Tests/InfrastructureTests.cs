using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using EtabsBridge.Core.Configuration;
using EtabsBridge.Core.Discovery;
using EtabsBridge.Core.Hosting;
using EtabsBridge.Core.Http;
using EtabsBridge.Core.Json;
using EtabsBridge.Core.Ports;
using EtabsBridge.Core.Tests.Fakes;
using Xunit;

namespace EtabsBridge.Core.Tests
{
    public sealed class TempDir : IDisposable
    {
        public TempDir()
        {
            Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "etabs-bridge-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }

        public void Dispose()
        {
            try
            {
                Directory.Delete(Path, true);
            }
            catch (IOException)
            {
            }
        }
    }

    public class InstanceRegistryTests : IDisposable
    {
        private readonly TempDir _dir = new TempDir();

        public void Dispose() => _dir.Dispose();

        private static InstanceRecord Record(int pid) => new InstanceRecord
        {
            ProcessId = pid,
            Port = 52780,
            BaseUrl = "http://localhost:52780",
            Token = "t",
            ModelPath = @"C:\M\A.EDB",
            BridgeVersion = "0.1.0",
            StartedAt = "2026-01-01T00:00:00Z",
        };

        [Fact]
        public void RegisterListUnregister()
        {
            var registry = new InstanceRegistry(_dir.Path);
            registry.Register(Record(10));
            registry.Register(Record(11));
            registry.Register(Record(10)); // replace is fine

            IReadOnlyList<InstanceRecord> live = registry.List(_ => true);
            Assert.Equal(new[] { 10, 11 }, live.Select(r => r.ProcessId));
            Assert.Equal(@"C:\M\A.EDB", live[0].ModelPath);
            Assert.Equal("http://localhost:52780", live[0].BaseUrl);

            registry.Unregister(10);
            Assert.Single(registry.List(_ => true));
            Assert.Empty(Directory.GetFiles(_dir.Path, "*.tmp"));
        }

        [Fact]
        public void ListRemovesDeadAndSkipsCorruptRecords()
        {
            var registry = new InstanceRegistry(_dir.Path);
            registry.Register(Record(20));
            registry.Register(Record(21));
            File.WriteAllText(System.IO.Path.Combine(_dir.Path, "99.json"), "{ corrupt");

            IReadOnlyList<InstanceRecord> live = registry.List(pid => pid == 21);

            Assert.Equal(new[] { 21 }, live.Select(r => r.ProcessId));
            Assert.False(File.Exists(System.IO.Path.Combine(_dir.Path, "20.json")));
        }

        [Fact]
        public void MissingDirectoryIsEmpty()
        {
            Assert.Empty(new InstanceRegistry(System.IO.Path.Combine(_dir.Path, "nope")).List());
        }

        [Fact]
        public void DefaultListUsesRealProcessCheck()
        {
            var registry = new InstanceRegistry(_dir.Path);
            registry.Register(Record(System.Diagnostics.Process.GetCurrentProcess().Id));
            registry.Register(Record(int.MaxValue - 1));

            Assert.Single(registry.List());
        }
    }

    public class BridgeSettingsTests : IDisposable
    {
        private readonly TempDir _dir = new TempDir();

        public void Dispose() => _dir.Dispose();

        [Fact]
        public void MissingFileIsCreatedWithDefaults()
        {
            string path = Path.Combine(_dir.Path, "sub", "settings.json");
            BridgeSettings s = BridgeSettings.Load(path, out string? warning);

            Assert.Null(warning);
            Assert.Equal(52780, s.PreferredPort);
            Assert.True(File.Exists(path));
            JsonValue saved = JsonParser.Parse(File.ReadAllText(path));
            Assert.Equal(52780, saved.GetInt64("preferredPort"));
            Assert.Equal("http://localhost:5173/", saved.GetString("webAppUrl"));
        }

        [Fact]
        public void ValidValuesOverrideDefaults()
        {
            string path = Path.Combine(_dir.Path, "settings.json");
            File.WriteAllText(path, "{\"preferredPort\":60000,\"allowedOrigins\":[\"https://app.example.com/\"],\"webAppUrl\":\"https://app.example.com/etabs\",\"callTimeoutSeconds\":30}");

            BridgeSettings s = BridgeSettings.Load(path, out string? warning);

            Assert.Null(warning);
            Assert.Equal(60000, s.PreferredPort);
            Assert.Equal(new[] { "https://app.example.com" }, s.AllowedOrigins);
            Assert.Equal("https://app.example.com/etabs", s.WebAppUrl);
            Assert.Equal(30, s.CallTimeoutSeconds);
        }

        [Fact]
        public void InvalidValuesWarnAndFallBack()
        {
            string path = Path.Combine(_dir.Path, "settings.json");
            File.WriteAllText(path, "{\"preferredPort\":80,\"allowedOrigins\":\"x\",\"webAppUrl\":\"ftp://a\",\"callTimeoutSeconds\":\"1\"}");

            BridgeSettings s = BridgeSettings.Load(path, out string? warning);

            Assert.Equal(52780, s.PreferredPort);
            Assert.Equal(120, s.CallTimeoutSeconds);
            Assert.Contains("preferredPort", warning);
            Assert.Contains("allowedOrigins", warning);
            Assert.Contains("webAppUrl", warning);
            Assert.Contains("callTimeoutSeconds", warning);
        }

        [Fact]
        public void BrokenJsonWarnsAndUsesDefaults()
        {
            string path = Path.Combine(_dir.Path, "settings.json");
            File.WriteAllText(path, "{ nope");
            BridgeSettings s = BridgeSettings.Load(path, out string? warning);
            Assert.NotNull(warning);
            Assert.Equal(52780, s.PreferredPort);
        }

        [Fact]
        public void TokensAreRandomAndUrlSafe()
        {
            string a = BridgeSecurity.CreateToken();
            string b = BridgeSecurity.CreateToken();

            Assert.NotEqual(a, b);
            Assert.Equal(43, a.Length);
            Assert.DoesNotContain('+', a);
            Assert.DoesNotContain('/', a);
            Assert.DoesNotContain('=', a);
        }

        [Fact]
        public void WebAppLinkPutsSecretsInFragment()
        {
            string link = BridgeSecurity.BuildWebAppLink("https://app.example.com/etabs#old", "http://localhost:52780", "a b&c");
            Assert.Equal("https://app.example.com/etabs#bridgeUrl=http%3A%2F%2Flocalhost%3A52780&token=a%20b%26c", link);
        }
    }

    public class DispatcherTests
    {
        /// <summary>A single-thread SynchronizationContext standing in for the ETABS UI thread.</summary>
        private sealed class SingleThreadContext : SynchronizationContext, IDisposable
        {
            private readonly BlockingCollection<(SendOrPostCallback, object?)> _queue = new BlockingCollection<(SendOrPostCallback, object?)>();
            private readonly Thread _thread;

            public SingleThreadContext()
            {
                _thread = new Thread(() =>
                {
                    foreach ((SendOrPostCallback callback, object? state) in _queue.GetConsumingEnumerable())
                    {
                        callback(state);
                    }
                })
                { IsBackground = true };
                _thread.Start();
            }

            public int ThreadId => _thread.ManagedThreadId;

            public ManualResetEventSlim Gate { get; } = new ManualResetEventSlim(true);

            public override void Post(SendOrPostCallback d, object? state) => _queue.Add((s => { Gate.Wait(); d(s); }, state));

            public void Dispose() => _queue.CompleteAdding();
        }

        [Fact]
        public async Task RunsWorkOnTheContextThread()
        {
            using var context = new SingleThreadContext();
            var dispatcher = new SynchronizationContextDispatcher(context);

            int threadId = await dispatcher.InvokeAsync(() => Environment.CurrentManagedThreadId, CancellationToken.None);

            Assert.Equal(context.ThreadId, threadId);
        }

        [Fact]
        public async Task PropagatesExceptions()
        {
            using var context = new SingleThreadContext();
            var dispatcher = new SynchronizationContextDispatcher(context);

            await Assert.ThrowsAsync<EtabsApiException>(() => dispatcher.InvokeAsync<int>(() => throw new EtabsApiException("X", 1), CancellationToken.None));
        }

        [Fact]
        public async Task CancelledWorkNeverRuns()
        {
            using var context = new SingleThreadContext();
            context.Gate.Reset(); // UI thread "busy"
            var dispatcher = new SynchronizationContextDispatcher(context);
            using var cts = new CancellationTokenSource();
            bool ran = false;

            Task<bool> task = dispatcher.InvokeAsync(() => ran = true, cts.Token);
            cts.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => task);

            context.Gate.Set();
            await dispatcher.InvokeAsync(() => 0, CancellationToken.None); // drain the queue
            Assert.False(ran);
        }

        [Fact]
        public async Task SerialDispatcherRunsOneAtATime()
        {
            var dispatcher = new SerialDispatcher();
            int active = 0, maxActive = 0;
            Task[] tasks = Enumerable.Range(0, 8).Select(_ => Task.Run(() => dispatcher.InvokeAsync(
                () =>
                {
                    int now = Interlocked.Increment(ref active);
                    maxActive = Math.Max(maxActive, now);
                    Thread.Sleep(5);
                    Interlocked.Decrement(ref active);
                    return 0;
                },
                CancellationToken.None))).ToArray();
            await Task.WhenAll(tasks);
            Assert.Equal(1, maxActive);
        }
    }

    /// <summary>End-to-end over a real socket (HttpListener works on Linux CI too).</summary>
    public class BridgeHttpServerTests : IDisposable
    {
        private readonly TempDir _dir = new TempDir();

        public void Dispose() => _dir.Dispose();

        private static int FreePortBase() => 40000 + new Random().Next(0, 20000);

        private BridgeHost StartHost(int port)
        {
            var settings = new BridgeSettings { PreferredPort = port, CallTimeoutSeconds = 10 };
            var host = new BridgeHost(new FakeEtabsModel(), new SerialDispatcher(), settings, 777, new InstanceRegistry(_dir.Path));
            host.Start();
            return host;
        }

        [Fact]
        public async Task ServesRequestsAndRegistersInstance()
        {
            using BridgeHost host = StartHost(FreePortBase());
            using var http = new HttpClient { BaseAddress = new Uri(host.BaseUrl) };

            HttpResponseMessage health = await http.GetAsync("/api/v1/health");
            Assert.Equal(HttpStatusCode.OK, health.StatusCode);

            HttpResponseMessage unauthorized = await http.GetAsync("/api/v1/geometry");
            Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);

            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", host.Token);
            HttpResponseMessage geometry = await http.GetAsync("/api/v1/geometry");
            Assert.Equal(HttpStatusCode.OK, geometry.StatusCode);
            Assert.Equal("application/json", geometry.Content.Headers.ContentType!.MediaType);
            JsonValue json = JsonParser.Parse(await geometry.Content.ReadAsStringAsync());
            Assert.Equal(5, json.Get("frames")!.AsArray().Count);

            HttpResponseMessage rpc = await http.PostAsync(
                "/api/v1/rpc",
                new StringContent("{\"method\":\"FrameObj.GetSection\",\"args\":{\"Name\":\"C1\"}}", Encoding.UTF8, "application/json"));
            Assert.Equal(HttpStatusCode.OK, rpc.StatusCode);

            InstanceRecord record = Assert.Single(new InstanceRegistry(_dir.Path).List(_ => true));
            Assert.Equal(777, record.ProcessId);
            Assert.Equal(host.BaseUrl, record.BaseUrl);
            Assert.Equal(host.Token, record.Token);

            host.Stop();
            Assert.Empty(new InstanceRegistry(_dir.Path).List(_ => true));
        }

        [Fact]
        public async Task SecondInstanceTakesNextPort()
        {
            int port = FreePortBase();
            using BridgeHost first = StartHost(port);
            using BridgeHost second = StartHost(first.Port);

            Assert.NotEqual(first.Port, second.Port);
            Assert.True(second.Port > first.Port);

            using var http = new HttpClient();
            Assert.Equal(HttpStatusCode.OK, (await http.GetAsync(second.BaseUrl + "/api/v1/health")).StatusCode);
        }

        [Fact]
        public async Task RejectsOversizedBodies()
        {
            using BridgeHost host = StartHost(FreePortBase());
            using var http = new HttpClient();
            http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", host.Token);

            var big = new StringContent("{\"method\":\"" + new string('a', 2 * 1024 * 1024) + "\"}", Encoding.UTF8, "application/json");
            HttpResponseMessage response = await http.PostAsync(host.BaseUrl + "/api/v1/rpc", big);

            Assert.Equal((HttpStatusCode)413, response.StatusCode);
        }

        [Fact]
        public void WebAppLinkUsesRunningServer()
        {
            using BridgeHost host = StartHost(FreePortBase());
            Assert.Contains("#bridgeUrl=http%3A%2F%2Flocalhost%3A" + host.Port, host.WebAppLink);
            Assert.EndsWith("&token=" + host.Token, host.WebAppLink);
        }
    }
}

namespace EtabsBridge.Core.Tests
{
    public class OriginMatcherTests
    {
        [Theory]
        [InlineData("https://app.example.com", true)]
        [InlineData("https://APP.example.com/", true)]
        [InlineData("http://app.example.com", false)] // scheme must match
        [InlineData("https://etabs-viewer.vercel.app", true)]
        [InlineData("https://etabs-viewer-git-dev-team.vercel.app", true)]
        [InlineData("https://a.b.vercel.app", false)] // '*' never spans a dot
        [InlineData("https://vercel.app", false)]
        [InlineData("https://evil.com/x.vercel.app", false)]
        [InlineData("https://x.vercel.app.evil.com", false)]
        [InlineData("http://localhost:5173", true)]
        [InlineData("http://localhost:5174", false)]
        [InlineData("", false)]
        [InlineData(null, false)]
        public void MatchesExactAndWildcardOrigins(string? origin, bool expected)
        {
            var matcher = new EtabsBridge.Core.Http.OriginMatcher(new[] { "https://app.example.com/", "https://*.vercel.app", "http://localhost:5173", " " });
            Assert.Equal(expected, matcher.IsAllowed(origin));
        }

        [Fact]
        public void StarAllowsAnything()
        {
            Assert.True(new EtabsBridge.Core.Http.OriginMatcher(new[] { "*" }).IsAllowed("https://anything.example"));
        }

        [Fact]
        public void EmptyListAllowsNothing()
        {
            Assert.False(new EtabsBridge.Core.Http.OriginMatcher(System.Array.Empty<string>()).IsAllowed("http://localhost:5173"));
        }
    }
}
