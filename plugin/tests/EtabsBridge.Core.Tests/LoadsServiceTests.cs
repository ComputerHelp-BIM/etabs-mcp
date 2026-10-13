using System.Linq;
using EtabsBridge.Core.Model;
using EtabsBridge.Core.Services;
using EtabsBridge.Core.Tests.Fakes;
using Xunit;

namespace EtabsBridge.Core.Tests
{
    public class LoadsServiceTests
    {
        private readonly LoadsResult _r = new LoadsService(new FakeEtabsModel()).GetLoads();

        [Fact]
        public void ReadsPatternsWithTypeAndSelfWeight()
        {
            Assert.Equal(new[] { "Dead", "SDL", "Live", "EQX" }, _r.Patterns.Select(p => p.Name));
            Assert.Equal("SuperDead", _r.Patterns[1].Type);
            Assert.Equal(1, _r.Patterns[0].SelfWeightMultiplier);
            Assert.Equal("Quake", _r.Patterns[3].Type);
        }

        [Fact]
        public void ReadsCasesFallingBackToOlderGetter()
        {
            LoadCase modal = _r.Cases.Single(c => c.Name == "Modal");
            Assert.Equal("Modal", modal.Type);
            Assert.Equal(1, modal.SubType);
            Assert.DoesNotContain(_r.Warnings, w => w.Contains("GetTypeOAPI_1"));
        }

        [Fact]
        public void ReadsCombinationsWithItems()
        {
            LoadCombination uls = _r.Combinations.Single(c => c.Name == "ULS1");
            Assert.Equal("LinearAdditive", uls.Type);
            Assert.Equal(new[] { ("LoadCase", "Dead", 1.5), ("LoadCase", "Live", 1.5) }, uls.Items.Select(i => (i.Kind, i.Name, i.Factor)));

            LoadCombination env = _r.Combinations.Single(c => c.Name == "ENV");
            Assert.Equal("Envelope", env.Type);
            Assert.Equal("LoadCombo", env.Items.Single().Kind);
        }

        [Fact]
        public void ReadsAssignedLoadsForTheWholeModel()
        {
            FrameDistributedLoad d = Assert.Single(_r.FrameDistributed);
            Assert.Equal(("3", "SDL", "Force", 10, 6.0, 10.0), (d.Frame, d.Pattern, d.LoadType, d.Direction, d.DistanceEnd, d.ValueStart));

            Assert.Equal(2, _r.AreaUniform.Count);
            Assert.Equal(3.0, _r.AreaUniform.Single(a => a.Pattern == "Live").Value);

            JointLoad j = Assert.Single(_r.JointLoads);
            Assert.Equal(("9", "EQX", 120.0), (j.Joint, j.Pattern, j.F1));
        }

        [Fact]
        public void MissingGetterGivesEmptyListAndWarning()
        {
            Assert.Empty(_r.FramePoint);
            Assert.Single(_r.Warnings, w => w.Contains("FrameObj.GetLoadPoint"));
        }

        [Theory]
        [InlineData("LoadCase", "LoadCase")]
        [InlineData("LoadCombo", "LoadCombo")]
        [InlineData("1", "LoadCombo")]
        [InlineData("0", "LoadCase")]
        public void NormalizesComboItemKinds(string raw, string expected)
        {
            Assert.Equal(expected, LoadsService.NormalizeComboItemKind(raw));
        }
    }
}
