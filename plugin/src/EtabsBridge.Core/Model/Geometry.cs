using System;
using System.Collections.Generic;

// JSON contract for the geometry endpoints. Property names are serialized in
// camelCase and must stay in sync with:
//   * docs/api.md                      (human-readable contract)
//   * packages/client/src/schemas.ts   (zod schemas used by web app + MCP)
//   * contract/fixtures/*.json         (golden files checked by C# and TS tests)
// Adding a property is a MINOR version change; renaming/removing one is MAJOR.
namespace EtabsBridge.Core.Model
{
    /// <summary>Present display units of the ETABS model, e.g. kN_m_C.</summary>
    public sealed class UnitsInfo
    {
        /// <summary>ETABS eUnits name, e.g. "kN_m_C".</summary>
        public string Name { get; set; } = string.Empty;

        public string Force { get; set; } = string.Empty;

        public string Length { get; set; } = string.Empty;

        /// <summary>"C" or "F".</summary>
        public string Temperature { get; set; } = string.Empty;
    }

    public sealed class Point3
    {
        public Point3()
        {
        }

        public Point3(double x, double y, double z)
        {
            X = x;
            Y = y;
            Z = z;
        }

        public double X { get; set; }

        public double Y { get; set; }

        public double Z { get; set; }
    }

    /// <summary>General information about the connected model and the bridge serving it.</summary>
    public sealed class ModelInfo
    {
        /// <summary>File name with extension, e.g. "Tower.EDB"; empty for an unsaved model.</summary>
        public string FileName { get; set; } = string.Empty;

        /// <summary>Full path; empty for an unsaved model.</summary>
        public string FilePath { get; set; } = string.Empty;

        public string EtabsVersion { get; set; } = string.Empty;

        public double EtabsVersionNumber { get; set; }

        /// <summary>True when the model is locked (e.g. after analysis); edits require unlocking.</summary>
        public bool IsLocked { get; set; }

        public UnitsInfo Units { get; set; } = new UnitsInfo();

        /// <summary>Windows process ID of this ETABS instance.</summary>
        public int ProcessId { get; set; }

        /// <summary>Semantic version of the bridge plugin.</summary>
        public string BridgeVersion { get; set; } = string.Empty;
    }

    public sealed class Story
    {
        public string Name { get; set; } = string.Empty;

        /// <summary>Elevation of the story's top (floor) level.</summary>
        public double Elevation { get; set; }

        public double Height { get; set; }

        public bool IsMaster { get; set; }

        /// <summary>Master story this story is similar to, or null.</summary>
        public string? SimilarTo { get; set; }

        public bool SpliceAbove { get; set; }

        public double SpliceHeight { get; set; }

        /// <summary>Display color as "#rrggbb".</summary>
        public string Color { get; set; } = "#808080";
    }

    public sealed class StoriesResult
    {
        public UnitsInfo Units { get; set; } = new UnitsInfo();

        public double BaseElevation { get; set; }

        /// <summary>Stories ordered bottom to top. The base level is not a story; see <see cref="BaseElevation"/>.</summary>
        public IReadOnlyList<Story> Stories { get; set; } = Array.Empty<Story>();
    }

    public sealed class GridLine
    {
        public string Id { get; set; } = string.Empty;

        public double Ordinate { get; set; }

        public bool Visible { get; set; } = true;

        /// <summary>"Start", "End" or as reported by ETABS.</summary>
        public string BubbleLocation { get; set; } = string.Empty;
    }

    public sealed class GridSystem
    {
        public string Name { get; set; } = string.Empty;

        /// <summary>"Cartesian", "Cylindrical", ... as reported by ETABS.</summary>
        public string Type { get; set; } = string.Empty;

        public double OriginX { get; set; }

        public double OriginY { get; set; }

        /// <summary>Rotation about Z in degrees.</summary>
        public double RotationDeg { get; set; }

        public IReadOnlyList<GridLine> XLines { get; set; } = Array.Empty<GridLine>();

        public IReadOnlyList<GridLine> YLines { get; set; } = Array.Empty<GridLine>();
    }

    public sealed class GridsResult
    {
        public UnitsInfo Units { get; set; } = new UnitsInfo();

        public IReadOnlyList<GridSystem> GridSystems { get; set; } = Array.Empty<GridSystem>();
    }

    public sealed class Joint
    {
        /// <summary>Unique object name (ETABS "unique name").</summary>
        public string Name { get; set; } = string.Empty;

        /// <summary>Label shown in the ETABS UI (e.g. "1"); unique only per story.</summary>
        public string Label { get; set; } = string.Empty;

        public string Story { get; set; } = string.Empty;

        public double X { get; set; }

        public double Y { get; set; }

        public double Z { get; set; }

        /// <summary>Restraints [UX, UY, UZ, RX, RY, RZ].</summary>
        public IReadOnlyList<bool> Restraints { get; set; } = new bool[6];
    }

    public sealed class JointsResult
    {
        public UnitsInfo Units { get; set; } = new UnitsInfo();

        public IReadOnlyList<Joint> Joints { get; set; } = Array.Empty<Joint>();
    }

    public sealed class FrameMember
    {
        public string Name { get; set; } = string.Empty;

        public string Label { get; set; } = string.Empty;

        public string Story { get; set; } = string.Empty;

        /// <summary>Frame section property name.</summary>
        public string Section { get; set; } = string.Empty;

        /// <summary>Design orientation: "Column", "Beam", "Brace", "Null" or "Other".</summary>
        public string Type { get; set; } = string.Empty;

        public string Joint1 { get; set; } = string.Empty;

        public string Joint2 { get; set; } = string.Empty;

        public Point3 Start { get; set; } = new Point3();

        public Point3 End { get; set; } = new Point3();

        /// <summary>Local axis rotation angle in degrees.</summary>
        public double Angle { get; set; }

        /// <summary>ETABS cardinal (insertion) point, 1..11.</summary>
        public int CardinalPoint { get; set; }
    }

    public sealed class FramesResult
    {
        public UnitsInfo Units { get; set; } = new UnitsInfo();

        public IReadOnlyList<FrameMember> Frames { get; set; } = Array.Empty<FrameMember>();
    }

    public sealed class AreaObject
    {
        public string Name { get; set; } = string.Empty;

        public string Label { get; set; } = string.Empty;

        public string Story { get; set; } = string.Empty;

        /// <summary>Area (shell) section property name.</summary>
        public string Section { get; set; } = string.Empty;

        /// <summary>Design orientation: "Wall", "Floor", "Ramp", "Null" or "Other".</summary>
        public string Type { get; set; } = string.Empty;

        /// <summary>Boundary joint names in order.</summary>
        public IReadOnlyList<string> Joints { get; set; } = Array.Empty<string>();

        /// <summary>Boundary coordinates, same order as <see cref="Joints"/>.</summary>
        public IReadOnlyList<Point3> Points { get; set; } = Array.Empty<Point3>();
    }

    public sealed class AreasResult
    {
        public UnitsInfo Units { get; set; } = new UnitsInfo();

        public IReadOnlyList<AreaObject> Areas { get; set; } = Array.Empty<AreaObject>();
    }

    /// <summary>Complete geometry read in one pass (one ETABS UI-thread dispatch).</summary>
    public sealed class GeometrySnapshot
    {
        public ModelInfo Model { get; set; } = new ModelInfo();

        public UnitsInfo Units { get; set; } = new UnitsInfo();

        public double BaseElevation { get; set; }

        public IReadOnlyList<Story> Stories { get; set; } = Array.Empty<Story>();

        public IReadOnlyList<GridSystem> GridSystems { get; set; } = Array.Empty<GridSystem>();

        public IReadOnlyList<Joint> Joints { get; set; } = Array.Empty<Joint>();

        public IReadOnlyList<FrameMember> Frames { get; set; } = Array.Empty<FrameMember>();

        public IReadOnlyList<AreaObject> Areas { get; set; } = Array.Empty<AreaObject>();
    }
}
