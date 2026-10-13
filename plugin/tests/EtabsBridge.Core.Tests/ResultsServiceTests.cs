using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using EtabsBridge.Core.Http;
using EtabsBridge.Core.Json;
using EtabsBridge.Core.Model;
using EtabsBridge.Core.Ports;
using EtabsBridge.Core.Services;
using EtabsBridge.Core.Tests.Fakes;
using Xunit;

namespace EtabsBridge.Core.Tests
{
    public class ResultsServiceTests
    {
        private readonly ResultsService _svc = new ResultsService(new FakeEtabsModel());

        private static OutputSelection Sel(string[]? cases = null, string[]? combos = null) =>
            new OutputSelection { Cases = cases ?? Array.Empty<string>(), Combinations = combos ?? Array.Empty<string>() };

        [Fact]
        public void ReportsCaseStatusAndCombinations()
        {
            AnalysisStatus s = _svc.GetStatus();
            Assert.Equal(new[] { ("Dead", "Finished"), ("Live", "Finished"), ("Modal", "NotRun") }, s.Cases.Select(c => (c.Name, c.Status)));
            Assert.Equal(new[] { "ULS1", "ENV" }, s.Combinations);
        }

        [Fact]
        public void BaseReactionsOnlyForSelectedCasesAndCombos()
        {
            ResultRows<BaseReactionRow> r = _svc.GetBaseReactions(Sel(new[] { "Live" }, new[] { "ULS1" }));
            Assert.Equal(new[] { ("Live", 400.0), ("ULS1", 2100.0) }, r.Rows.Select(x => (x.LoadCase, x.Fz)));
            Assert.Equal(5.0, r.Rows[0].My); // read from "ParamMy"
            Assert.Equal(new[] { "Live" }, r.Cases);
            Assert.Equal("kN", r.Units.Force);
        }

        [Fact]
        public void SelectionFailuresBecomeWarnings()
        {
            ResultRows<BaseReactionRow> r = _svc.GetBaseReactions(Sel(new[] { "Dead", "Nope" }));
            Assert.Single(r.Rows);
            Assert.Contains(r.Warnings, w => w.Contains("SetCaseSelectedForOutput(Nope) returned 1"));
        }

        [Fact]
        public void EmptySelectionIsABadRequest()
        {
            BridgeException ex = Assert.Throws<BridgeException>(() => _svc.GetStoryDrifts(Sel()));
            Assert.Equal(400, ex.Status);
        }

        [Fact]
        public void ReadsDriftsReactionsDisplacementsAndForces()
        {
            ResultRows<StoryDriftRow> drifts = _svc.GetStoryDrifts(Sel(new[] { "Dead" }));
            Assert.Equal(new[] { "Story2", "Story1" }, drifts.Rows.Select(d => d.Story));
            Assert.Equal(0.002, drifts.Rows[0].Drift);

            Assert.Equal(new[] { "1", "2" }, _svc.GetJointReactions(Sel(new[] { "Dead" }), null).Rows.Select(x => x.Joint));
            Assert.Equal(new[] { "5" }, _svc.GetJointReactions(Sel(new[] { "Dead" }), "5").Rows.Select(x => x.Joint));

            JointDisplacementRow d = Assert.Single(_svc.GetJointDisplacements(Sel(new[] { "Live" }), "9").Rows);
            Assert.Equal((0.012, -0.003), (d.U1, d.U3));

            ResultRows<FrameForceRow> f = _svc.GetFrameForces(Sel(new[] { "Dead" }), "3");
            Assert.Equal(new[] { 0.0, 3.0, 6.0 }, f.Rows.Select(x => x.Station));
            Assert.Equal(45.0, f.Rows[1].M3);
        }

        [Fact]
        public void ConcreteDesignReadsBeamsAndWarnsForMissingColumns()
        {
            ResultRows<ConcreteDesignRow> r = _svc.GetConcreteDesign();
            Assert.Equal(2, r.Rows.Count);
            Assert.All(r.Rows, x => Assert.Equal("Beam", x.Kind));
            Assert.Equal(0.0012, r.Rows[0].TopArea);
            Assert.Equal(0.0005, r.Rows[0].ShearAreaPerLength);
            Assert.Contains(r.Warnings, w => w.Contains("GetSummaryResultsColumn"));
        }

        [Fact]
        public async Task HttpEndpointsParseSelectionAndPage()
        {
            var api = new BridgeApi(new FakeEtabsModel(), new SerialDispatcher(), new BridgeOptions { Token = BridgeApiTests.Token }, 1);
            async Task<(int, JsonValue)> Get(string pathAndQuery)
            {
                int q = pathAndQuery.IndexOf('?');
                var req = new BridgeRequest("GET", q < 0 ? pathAndQuery : pathAndQuery.Substring(0, q));
                if (q >= 0)
                {
                    foreach (string pair in pathAndQuery.Substring(q + 1).Split('&'))
                    {
                        string[] kv = pair.Split('=');
                        req.Query[kv[0]] = Uri.UnescapeDataString(kv[1]);
                    }
                }

                req.Headers["Authorization"] = "Bearer " + BridgeApiTests.Token;
                BridgeResponse res = await api.HandleAsync(req, CancellationToken.None);
                return (res.Status, JsonParser.Parse(res.Body!));
            }

            var (status, json) = await Get("/api/v1/results/frame-forces?cases=Dead,%20Live&frame=3&offset=2&limit=2");
            Assert.Equal(200, status);
            Assert.Equal(6, json.GetInt64("totalRows"));
            Assert.Equal(2, json.GetInt64("offset"));
            Assert.Equal(2, json.Get("rows")!.AsArray().Count);
            Assert.Equal(new[] { "Dead", "Live" }, json.Get("cases")!.AsArray().Select(x => x.AsString()));

            var (bad, err) = await Get("/api/v1/results/base-reactions");
            Assert.Equal(400, bad);
            Assert.Equal(ErrorCodes.BadRequest, err.Get("error")!.GetString("code"));

            Assert.Equal(200, (await Get("/api/v1/results/status")).Item1);
            Assert.Equal(200, (await Get("/api/v1/design/concrete?limit=1")).Item1);
        }
    }
}
