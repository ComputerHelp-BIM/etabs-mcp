using System;
using System.Linq;
using EtabsBridge.Core.Model;
using EtabsBridge.Core.Ports;
using EtabsBridge.Core.Services;
using EtabsBridge.Core.Tests.Fakes;
using Xunit;

namespace EtabsBridge.Core.Tests
{
    public class EtabsConventionsTests
    {
        [Theory]
        [InlineData("kN_m_C", "kN", "m", "C")]
        [InlineData("kip_ft_F", "kip", "ft", "F")]
        [InlineData("Ton_mm_C", "Ton", "mm", "C")]
        public void ParsesUnits(string name, string force, string length, string temperature)
        {
            UnitsInfo u = EtabsConventions.ParseUnits(name);
            Assert.Equal(name, u.Name);
            Assert.Equal(force, u.Force);
            Assert.Equal(length, u.Length);
            Assert.Equal(temperature, u.Temperature);
        }

        [Fact]
        public void UnknownUnitsKeepName()
        {
            UnitsInfo u = EtabsConventions.ParseUnits("weird");
            Assert.Equal("weird", u.Name);
            Assert.Equal(string.Empty, u.Force);
        }

        [Theory]
        [InlineData("Column", "Column")]
        [InlineData("Beam", "Beam")]
        [InlineData("Brace", "Brace")]
        [InlineData("Null", "Null")]
        [InlineData("Other", "Other")]
        [InlineData("7", "Other")]
        [InlineData("", "Other")]
        public void NormalizesFrameTypes(string input, string expected)
        {
            Assert.Equal(expected, EtabsConventions.NormalizeFrameType(input));
        }

        [Theory]
        [InlineData("Wall", "Wall")]
        [InlineData("Floor", "Floor")]
        [InlineData("Ramp_DO_NOT_USE", "Ramp")]
        [InlineData("Null", "Null")]
        [InlineData("Other", "Other")]
        public void NormalizesAreaTypes(string input, string expected)
        {
            Assert.Equal(expected, EtabsConventions.NormalizeAreaType(input));
        }

        [Fact]
        public void ConvertsOleColor()
        {
            // OLE colors are 0x00BBGGRR.
            Assert.Equal("#ff0000", EtabsConventions.OleColorToHex(0x0000FF));
            Assert.Equal("#00ff00", EtabsConventions.OleColorToHex(0x00FF00));
            Assert.Equal("#0000ff", EtabsConventions.OleColorToHex(0xFF0000));
            Assert.Equal("#123456", EtabsConventions.OleColorToHex(0x563412));
        }

        [Theory]
        [InlineData(null, null)]
        [InlineData("", null)]
        [InlineData("None", null)]
        [InlineData("Story2", "Story2")]
        public void EmptyToNull(string? input, string? expected)
        {
            Assert.Equal(expected, EtabsConventions.EmptyToNull(input));
        }
    }

    public class GeometryServiceTests
    {
        private readonly FakeEtabsModel _model = new FakeEtabsModel();

        [Fact]
        public void ModelInfoCombinesApiAndHostFacts()
        {
            ModelInfo info = new GeometryService(_model, 4242).GetModelInfo();

            Assert.Equal("Sample.EDB", info.FileName);
            Assert.Equal(@"C:\Models\Sample.EDB", info.FilePath);
            Assert.Equal("kN", info.Units.Force);
            Assert.Equal(4242, info.ProcessId);
            Assert.Equal(BridgeInfo.Version, info.BridgeVersion);
        }

        [Fact]
        public void StoriesAreBottomUpWithoutBase()
        {
            StoriesResult result = new GeometryService(_model, 1).GetStories();

            Assert.Equal(new[] { "Story1", "Story2" }, result.Stories.Select(s => s.Name));
            Assert.Equal(0, result.BaseElevation);
            Assert.Equal("Story2", result.Stories[0].SimilarTo);
        }

        [Fact]
        public void KeepsLowestStoryWhenNoBaseEntry()
        {
            var raw = new RawStories
            {
                BaseElevation = -3,
                Stories = new[] { new Story { Name = "B1", Elevation = 0, Height = 3 } },
            };

            Assert.Single(GeometryService.NormalizeStories(raw));
        }

        [Fact]
        public void AreaPointsResolvedFromJoints()
        {
            AreasResult result = new GeometryService(_model, 1).GetAreas();

            AreaObject slab = result.Areas.Single(a => a.Name == "1");
            Assert.Equal(4, slab.Points.Count);
            Assert.All(slab.Points, p => Assert.Equal(4.0, p.Z));
            Assert.Equal(6.0, slab.Points[1].X);
        }

        [Fact]
        public void MissingAreaJointIsAnApiError()
        {
            var areas = new[] { new AreaObject { Name = "9", Joints = new[] { "nope" } } };
            Assert.Throws<EtabsApiException>(() => GeometryService.ResolveAreaPoints(areas, _model.GetJoints()));
        }

        [Fact]
        public void SnapshotContainsEverything()
        {
            GeometrySnapshot snap = new GeometryService(_model, 7).GetSnapshot();

            Assert.Equal(7, snap.Model.ProcessId);
            Assert.Equal(2, snap.Stories.Count);
            Assert.Single(snap.GridSystems);
            Assert.Equal(12, snap.Joints.Count);
            Assert.Equal(5, snap.Frames.Count);
            Assert.Equal(2, snap.Areas.Count);
            Assert.All(snap.Areas, a => Assert.Equal(a.Joints.Count, a.Points.Count));
        }
    }

    public class TableReshaperTests
    {
        [Fact]
        public void SplitsRowMajorData()
        {
            var rows = TableReshaper.ToRows(new[] { "a", "1", "b", null!, "extra" }, 2, 2);

            Assert.Equal(2, rows.Count);
            Assert.Equal(new[] { "a", "1" }, rows[0]);
            Assert.Equal(new[] { "b", string.Empty }, rows[1]);
        }

        [Fact]
        public void EmptyWhenNoRecords()
        {
            Assert.Empty(TableReshaper.ToRows(null, 3, 0));
        }

        [Fact]
        public void ThrowsWhenDataIsShort()
        {
            Assert.Throws<EtabsApiException>(() => TableReshaper.ToRows(new[] { "a" }, 2, 1));
        }
    }
}
