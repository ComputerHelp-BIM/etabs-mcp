using System;
using System.Collections.Generic;

// JSON contract for GET /api/v1/loads (added in 0.5.0). Keep in sync with
// packages/client/src/schemas.ts and contract/fixtures/loads.json.
// Load values are in the model's present units (force, force/length, force/length²).
namespace EtabsBridge.Core.Model
{
    public sealed class LoadPattern
    {
        public string Name { get; set; } = string.Empty;

        /// <summary>ETABS eLoadPatternType name, e.g. "Dead", "SuperDead", "Live", "Quake", "Wind".</summary>
        public string Type { get; set; } = string.Empty;

        public double? SelfWeightMultiplier { get; set; }
    }

    public sealed class LoadCase
    {
        public string Name { get; set; } = string.Empty;

        /// <summary>ETABS eLoadCaseType name, e.g. "LinearStatic", "Modal", "ResponseSpectrum".</summary>
        public string Type { get; set; } = string.Empty;

        /// <summary>Sub-type code as reported by ETABS (meaning depends on Type), or null.</summary>
        public int? SubType { get; set; }
    }

    public sealed class CombinationItem
    {
        /// <summary>"LoadCase" or "LoadCombo".</summary>
        public string Kind { get; set; } = "LoadCase";

        public string Name { get; set; } = string.Empty;

        public double Factor { get; set; }
    }

    public sealed class LoadCombination
    {
        public string Name { get; set; } = string.Empty;

        /// <summary>"LinearAdditive", "Envelope", "AbsoluteAdditive", "SRSS", "RangeAdditive" or "Other".</summary>
        public string Type { get; set; } = string.Empty;

        public IReadOnlyList<CombinationItem> Items { get; set; } = Array.Empty<CombinationItem>();
    }

    public sealed class FrameDistributedLoad
    {
        public string Frame { get; set; } = string.Empty;

        public string Pattern { get; set; } = string.Empty;

        /// <summary>"Force" or "Moment".</summary>
        public string LoadType { get; set; } = "Force";

        public string CSys { get; set; } = string.Empty;

        /// <summary>
        /// ETABS direction code: 1-3 local axes, 4-6 global X/Y/Z, 7-9 projected X/Y/Z, 10 gravity, 11 projected gravity.
        /// </summary>
        public int Direction { get; set; }

        public double RelativeStart { get; set; }

        public double RelativeEnd { get; set; }

        /// <summary>Absolute start distance from joint I (length).</summary>
        public double DistanceStart { get; set; }

        public double DistanceEnd { get; set; }

        /// <summary>Load intensity at the start (force/length or moment/length).</summary>
        public double ValueStart { get; set; }

        public double ValueEnd { get; set; }
    }

    public sealed class FramePointLoad
    {
        public string Frame { get; set; } = string.Empty;

        public string Pattern { get; set; } = string.Empty;

        public string LoadType { get; set; } = "Force";

        public string CSys { get; set; } = string.Empty;

        public int Direction { get; set; }

        public double RelativeDistance { get; set; }

        public double Distance { get; set; }

        public double Value { get; set; }
    }

    public sealed class AreaUniformLoad
    {
        public string Area { get; set; } = string.Empty;

        public string Pattern { get; set; } = string.Empty;

        public string CSys { get; set; } = string.Empty;

        public int Direction { get; set; }

        /// <summary>Force per unit area.</summary>
        public double Value { get; set; }
    }

    public sealed class JointLoad
    {
        public string Joint { get; set; } = string.Empty;

        public string Pattern { get; set; } = string.Empty;

        public string CSys { get; set; } = string.Empty;

        public double F1 { get; set; }

        public double F2 { get; set; }

        public double F3 { get; set; }

        public double M1 { get; set; }

        public double M2 { get; set; }

        public double M3 { get; set; }
    }

    public sealed class LoadsResult
    {
        public UnitsInfo Units { get; set; } = new UnitsInfo();

        public IReadOnlyList<LoadPattern> Patterns { get; set; } = Array.Empty<LoadPattern>();

        public IReadOnlyList<LoadCase> Cases { get; set; } = Array.Empty<LoadCase>();

        public IReadOnlyList<LoadCombination> Combinations { get; set; } = Array.Empty<LoadCombination>();

        public IReadOnlyList<FrameDistributedLoad> FrameDistributed { get; set; } = Array.Empty<FrameDistributedLoad>();

        public IReadOnlyList<FramePointLoad> FramePoint { get; set; } = Array.Empty<FramePointLoad>();

        public IReadOnlyList<AreaUniformLoad> AreaUniform { get; set; } = Array.Empty<AreaUniformLoad>();

        public IReadOnlyList<JointLoad> JointLoads { get; set; } = Array.Empty<JointLoad>();

        public IReadOnlyList<string> Warnings { get; set; } = Array.Empty<string>();
    }
}
