using System;
using System.Collections.Generic;

// JSON contract for /api/v1/results/* and /api/v1/design/* (added in 0.6.0). Keep in sync with
// packages/client/src/schemas.ts and contract/fixtures/results-*.json.
// Values are in the model's present units. StepType/StepNum identify steps of multi-step cases
// (e.g. "Max"/"Min" for envelopes, mode numbers for modal cases).
namespace EtabsBridge.Core.Model
{
    public sealed class CaseStatus
    {
        public string Name { get; set; } = string.Empty;

        /// <summary>"NotRun", "CouldNotStart", "NotFinished", "Finished" or "Unknown".</summary>
        public string Status { get; set; } = "Unknown";
    }

    public sealed class AnalysisStatus
    {
        /// <summary>True when the model is locked, which ETABS does once it has been analysed.</summary>
        public bool IsLocked { get; set; }

        public IReadOnlyList<CaseStatus> Cases { get; set; } = Array.Empty<CaseStatus>();

        /// <summary>Load combination names (results are available for them once their cases have run).</summary>
        public IReadOnlyList<string> Combinations { get; set; } = Array.Empty<string>();

        public IReadOnlyList<string> Warnings { get; set; } = Array.Empty<string>();
    }

    /// <summary>A page of result rows for the selected cases/combinations.</summary>
    public sealed class ResultRows<TRow>
    {
        public UnitsInfo Units { get; set; } = new UnitsInfo();

        public IReadOnlyList<string> Cases { get; set; } = Array.Empty<string>();

        public IReadOnlyList<string> Combinations { get; set; } = Array.Empty<string>();

        public int TotalRows { get; set; }

        public int Offset { get; set; }

        public IReadOnlyList<TRow> Rows { get; set; } = Array.Empty<TRow>();

        /// <summary>Why rows may be missing (e.g. a case has not been run, or a getter is unavailable).</summary>
        public IReadOnlyList<string> Warnings { get; set; } = Array.Empty<string>();
    }

    public sealed class BaseReactionRow
    {
        public string LoadCase { get; set; } = string.Empty;

        public string StepType { get; set; } = string.Empty;

        public double StepNum { get; set; }

        public double Fx { get; set; }

        public double Fy { get; set; }

        public double Fz { get; set; }

        public double Mx { get; set; }

        public double My { get; set; }

        public double Mz { get; set; }
    }

    public sealed class StoryDriftRow
    {
        public string Story { get; set; } = string.Empty;

        public string LoadCase { get; set; } = string.Empty;

        public string StepType { get; set; } = string.Empty;

        public double StepNum { get; set; }

        /// <summary>"X" or "Y" (as reported by ETABS).</summary>
        public string Direction { get; set; } = string.Empty;

        /// <summary>Drift ratio (dimensionless).</summary>
        public double Drift { get; set; }

        /// <summary>Label of the point where the maximum drift occurs.</summary>
        public string Label { get; set; } = string.Empty;

        public double X { get; set; }

        public double Y { get; set; }

        public double Z { get; set; }
    }

    public sealed class JointReactionRow
    {
        public string Joint { get; set; } = string.Empty;

        public string LoadCase { get; set; } = string.Empty;

        public string StepType { get; set; } = string.Empty;

        public double StepNum { get; set; }

        public double F1 { get; set; }

        public double F2 { get; set; }

        public double F3 { get; set; }

        public double M1 { get; set; }

        public double M2 { get; set; }

        public double M3 { get; set; }
    }

    public sealed class JointDisplacementRow
    {
        public string Joint { get; set; } = string.Empty;

        public string LoadCase { get; set; } = string.Empty;

        public string StepType { get; set; } = string.Empty;

        public double StepNum { get; set; }

        public double U1 { get; set; }

        public double U2 { get; set; }

        public double U3 { get; set; }

        public double R1 { get; set; }

        public double R2 { get; set; }

        public double R3 { get; set; }
    }

    public sealed class FrameForceRow
    {
        public string Frame { get; set; } = string.Empty;

        /// <summary>Distance from joint I along the frame object.</summary>
        public double Station { get; set; }

        public string LoadCase { get; set; } = string.Empty;

        public string StepType { get; set; } = string.Empty;

        public double StepNum { get; set; }

        public double P { get; set; }

        public double V2 { get; set; }

        public double V3 { get; set; }

        public double T { get; set; }

        public double M2 { get; set; }

        public double M3 { get; set; }
    }

    /// <summary>Required reinforcement from ETABS concrete frame design, per frame and station.</summary>
    public sealed class ConcreteDesignRow
    {
        public string Frame { get; set; } = string.Empty;

        /// <summary>"Beam" or "Column".</summary>
        public string Kind { get; set; } = string.Empty;

        /// <summary>Station along the frame.</summary>
        public double Location { get; set; }

        /// <summary>Beams: required top longitudinal steel area.</summary>
        public double? TopArea { get; set; }

        /// <summary>Beams: required bottom longitudinal steel area.</summary>
        public double? BottomArea { get; set; }

        /// <summary>Columns: required total longitudinal steel area (PMM).</summary>
        public double? LongitudinalArea { get; set; }

        /// <summary>Required shear reinforcement area per unit length (major direction).</summary>
        public double? ShearAreaPerLength { get; set; }

        /// <summary>Columns: PMM ratio (design check), when ETABS reports one.</summary>
        public double? Ratio { get; set; }

        /// <summary>Governing combination for the longitudinal steel.</summary>
        public string Combo { get; set; } = string.Empty;
    }
}
