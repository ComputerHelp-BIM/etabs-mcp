using System;
using System.Collections.Generic;

// JSON contract for GET /api/v1/sections (added in 0.2.0). Keep in sync with
// packages/client/src/schemas.ts and contract/fixtures/sections.json.
// Values that ETABS could not provide for a given material/section are null, never guessed.
namespace EtabsBridge.Core.Model
{
    public sealed class Material
    {
        public string Name { get; set; } = string.Empty;

        /// <summary>"Concrete", "Steel", "Rebar", "Tendon", "Aluminum", "ColdFormed", "Masonry", "NoDesign" or "Other".</summary>
        public string Type { get; set; } = "Other";

        /// <summary>Display color "#rrggbb".</summary>
        public string Color { get; set; } = "#808080";

        /// <summary>Modulus of elasticity (force/length²).</summary>
        public double? E { get; set; }

        /// <summary>Poisson's ratio (isotropic materials).</summary>
        public double? Poisson { get; set; }

        /// <summary>Coefficient of thermal expansion.</summary>
        public double? ThermalCoefficient { get; set; }

        /// <summary>Weight per unit volume (force/length³).</summary>
        public double? UnitWeight { get; set; }

        /// <summary>Concrete compressive strength f'c (force/length²).</summary>
        public double? Fc { get; set; }

        /// <summary>Yield strength (steel, rebar, tendon).</summary>
        public double? Fy { get; set; }

        /// <summary>Ultimate strength (steel, rebar, tendon).</summary>
        public double? Fu { get; set; }
    }

    /// <summary>Section properties from PropFrame.GetSectProps (local axes 2 and 3).</summary>
    public sealed class SectionProperties
    {
        public double Area { get; set; }

        public double As2 { get; set; }

        public double As3 { get; set; }

        public double Torsion { get; set; }

        public double I22 { get; set; }

        public double I33 { get; set; }

        public double S22 { get; set; }

        public double S33 { get; set; }

        public double Z22 { get; set; }

        public double Z33 { get; set; }

        public double R22 { get; set; }

        public double R33 { get; set; }
    }

    public sealed class FrameSection
    {
        public string Name { get; set; } = string.Empty;

        /// <summary>
        /// Normalized shape: "Rectangular", "Circle", "I", "Box", "Pipe", "Tee", "Angle", "Channel",
        /// "DoubleAngle", "DoubleChannel", "SectionDesigner", "Nonprismatic", "AutoSelect", "General" or "Other".
        /// </summary>
        public string Shape { get; set; } = "Other";

        /// <summary>Raw ETABS eFramePropType name, for anything the normalized shape does not capture.</summary>
        public string EtabsType { get; set; } = string.Empty;

        public string Material { get; set; } = string.Empty;

        public string Color { get; set; } = "#808080";

        /// <summary>Overall depth t3, measured along local axis 2 (diameter for circles/pipes).</summary>
        public double? Depth { get; set; }

        /// <summary>Overall (top flange) width t2, measured along local axis 3.</summary>
        public double? Width { get; set; }

        public double? FlangeThickness { get; set; }

        public double? WebThickness { get; set; }

        /// <summary>Bottom flange width t2b (I sections).</summary>
        public double? BottomWidth { get; set; }

        /// <summary>Bottom flange thickness tfb (I sections).</summary>
        public double? BottomFlangeThickness { get; set; }

        public SectionProperties? Properties { get; set; }
    }

    public sealed class AreaSection
    {
        public string Name { get; set; } = string.Empty;

        /// <summary>"Slab", "Wall", "Deck" or "Other".</summary>
        public string Kind { get; set; } = "Other";

        /// <summary>ETABS sub-type, e.g. "Slab", "Drop", "Ribbed", "Waffle", "Mat", "Footing", "Specified".</summary>
        public string SubType { get; set; } = string.Empty;

        /// <summary>ETABS shell type, e.g. "ShellThin", "ShellThick", "Membrane", "Layered".</summary>
        public string ShellType { get; set; } = string.Empty;

        public string Material { get; set; } = string.Empty;

        /// <summary>Overall thickness (slab/wall), or null when not available (e.g. decks).</summary>
        public double? Thickness { get; set; }

        public string Color { get; set; } = "#808080";
    }

    public sealed class SectionsResult
    {
        public UnitsInfo Units { get; set; } = new UnitsInfo();

        public IReadOnlyList<Material> Materials { get; set; } = Array.Empty<Material>();

        public IReadOnlyList<FrameSection> FrameSections { get; set; } = Array.Empty<FrameSection>();

        public IReadOnlyList<AreaSection> AreaSections { get; set; } = Array.Empty<AreaSection>();

        /// <summary>
        /// API calls that were unavailable or failed for some items (values left null). Empty when
        /// everything was read. Lets one unsupported section type degrade gracefully instead of failing the request.
        /// </summary>
        public IReadOnlyList<string> Warnings { get; set; } = Array.Empty<string>();
    }
}
