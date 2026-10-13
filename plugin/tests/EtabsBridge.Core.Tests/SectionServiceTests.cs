using System.Linq;
using EtabsBridge.Core.Model;
using EtabsBridge.Core.Services;
using EtabsBridge.Core.Tests.Fakes;
using Xunit;

namespace EtabsBridge.Core.Tests
{
    public class SectionServiceTests
    {
        private readonly SectionsResult _result = new SectionService(new FakeEtabsModel()).GetSections();

        [Fact]
        public void ReadsMaterialsByType()
        {
            Material concrete = _result.Materials.Single(m => m.Name == "C30");
            Assert.Equal("Concrete", concrete.Type);
            Assert.Equal(30_000_000, concrete.E);
            Assert.Equal(0.2, concrete.Poisson);
            Assert.Equal(24.9926, concrete.UnitWeight);
            Assert.Equal(30_000, concrete.Fc);
            Assert.Null(concrete.Fy);

            Material rebar = _result.Materials.Single(m => m.Name == "HRB500");
            Assert.Equal("Rebar", rebar.Type);
            Assert.Equal(200_000_000, rebar.E); // via the uniaxial fallback
            Assert.Null(rebar.Poisson);
            Assert.Equal(500_000, rebar.Fy);
            Assert.Equal(650_000, rebar.Fu);
        }

        [Fact]
        public void MissingGetterLeavesNullsAndOneWarning()
        {
            Material steel = _result.Materials.Single(m => m.Name == "A992Fy50");
            Assert.Equal("Steel", steel.Type);
            Assert.Equal(200_000_000, steel.E);
            Assert.Null(steel.Fy);
            Assert.Single(_result.Warnings, w => w.Contains("PropMaterial.GetOSteel_1"));
        }

        [Fact]
        public void ReadsFrameSectionDimensions()
        {
            FrameSection column = _result.FrameSections.Single(s => s.Name == "C500");
            Assert.Equal("Rectangular", column.Shape);
            Assert.Equal("Rectangular", column.EtabsType);
            Assert.Equal("C30", column.Material);
            Assert.Equal(0.5, column.Depth);
            Assert.Equal(0.5, column.Width);
            Assert.Equal("#ff0000", column.Color);
            Assert.Equal(0.25, column.Properties!.Area);

            FrameSection beam = _result.FrameSections.Single(s => s.Name == "B300x600");
            Assert.Equal(0.6, beam.Depth);
            Assert.Equal(0.3, beam.Width);
        }

        [Fact]
        public void FallsBackToOlderGetterNames()
        {
            FrameSection w = _result.FrameSections.Single(s => s.Name == "W12X26");
            Assert.Equal("I", w.Shape);
            Assert.Equal("A992Fy50", w.Material);
            Assert.Equal(0.3112, w.Depth);
            Assert.Equal(0.0112, w.FlangeThickness);
            Assert.Equal(0.0058, w.WebThickness);
            Assert.Equal(0.1648, w.BottomWidth);
            // GetISection_1 was tried quietly first: no warning for it.
            Assert.DoesNotContain(_result.Warnings, x => x.Contains("GetISection_1"));
        }

        [Fact]
        public void CirclesUseDiameterForBothDimensions()
        {
            FrameSection pile = _result.FrameSections.Single(s => s.Name == "PILE600");
            Assert.Equal("Circle", pile.Shape);
            Assert.Equal(0.6, pile.Depth);
            Assert.Equal(0.6, pile.Width);
        }

        [Fact]
        public void UnsupportedShapesKeepMaterialAndWarnOnFailedProps()
        {
            FrameSection sd = _result.FrameSections.Single(s => s.Name == "SD1");
            Assert.Equal("SectionDesigner", sd.Shape);
            Assert.Equal("C30", sd.Material); // from PropFrame.GetMaterial
            Assert.Null(sd.Depth);
            Assert.Null(sd.Properties);
            Assert.Contains(_result.Warnings, w => w.Contains("PropFrame.GetSectProps(SD1) returned 1"));
        }

        [Fact]
        public void ReadsAreaSectionsByKind()
        {
            AreaSection slab = _result.AreaSections.Single(s => s.Name == "Slab200");
            Assert.Equal("Slab", slab.Kind);
            Assert.Equal("Slab", slab.SubType);
            Assert.Equal("ShellThin", slab.ShellType);
            Assert.Equal(0.2, slab.Thickness);
            Assert.Equal("#00ff00", slab.Color);

            AreaSection wall = _result.AreaSections.Single(s => s.Name == "Wall250");
            Assert.Equal("Wall", wall.Kind);
            Assert.Equal("Specified", wall.SubType);
            Assert.Equal(0.25, wall.Thickness);

            AreaSection unknown = _result.AreaSections.Single(s => s.Name == "Mystery");
            Assert.Equal("Other", unknown.Kind);
            Assert.Null(unknown.Thickness);
            Assert.Contains(_result.Warnings, w => w.Contains("'Mystery'"));
        }

        [Fact]
        public void ModelWithoutSectionApiReturnsEmptyListsWithWarnings()
        {
            // A root object without PropMaterial/PropFrame/PropArea.
            var model = new FakeEtabsModel(new object(), typeof(object));
            SectionsResult r = new SectionService(model).GetSections();
            Assert.Empty(r.Materials);
            Assert.Empty(r.FrameSections);
            Assert.Empty(r.AreaSections);
            Assert.Equal(3, r.Warnings.Count);
        }

        [Theory]
        [InlineData("Rectangular", "Rectangular")]
        [InlineData("ConcreteTee", "Tee")]
        [InlineData("T", "Tee")]
        [InlineData("ConcreteL", "Angle")]
        [InlineData("Box", "Box")]
        [InlineData("DbChannel", "DoubleChannel")]
        [InlineData("Variable", "Nonprismatic")]
        [InlineData("Auto", "AutoSelect")]
        [InlineData("BuiltupICoverplate", "Other")]
        [InlineData(null, "Other")]
        public void NormalizesFrameShapes(string? etabs, string expected)
        {
            Assert.Equal(expected, SectionService.NormalizeFrameShape(etabs));
        }

        [Theory]
        [InlineData("Concrete", "Concrete")]
        [InlineData("ColdFormed", "ColdFormed")]
        [InlineData("NoDesign", "NoDesign")]
        [InlineData("7", "Other")]
        public void NormalizesMaterialTypes(string etabs, string expected)
        {
            Assert.Equal(expected, SectionService.NormalizeMaterialType(etabs));
        }
    }
}
