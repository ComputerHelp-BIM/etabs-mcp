using System;
using System.Collections.Generic;
using System.Linq;
using EtabsBridge.Core.Model;
using EtabsBridge.Core.Ports;

namespace EtabsBridge.Core.Services
{
    /// <summary>
    /// Builds the geometry contract from an <see cref="IEtabsModel"/>.
    ///
    /// All methods are synchronous and must run on the ETABS API thread
    /// (wrap calls in <see cref="IEtabsDispatcher.InvokeAsync{T}"/>). Usable directly
    /// from DraftWin: <c>New GeometryService(New EtabsApiModel(sapModel), pid).GetSnapshot()</c>.
    /// </summary>
    public sealed class GeometryService
    {
        /// <summary>Tolerance for comparing elevations, in model length units.</summary>
        private const double ElevationTolerance = 1e-6;

        private readonly IEtabsModel _model;
        private readonly int _etabsProcessId;

        /// <param name="model">ETABS API port.</param>
        /// <param name="etabsProcessId">Process ID of the ETABS instance <paramref name="model"/> belongs to.</param>
        public GeometryService(IEtabsModel model, int etabsProcessId)
        {
            _model = model ?? throw new ArgumentNullException(nameof(model));
            _etabsProcessId = etabsProcessId;
        }

        public ModelInfo GetModelInfo()
        {
            RawModelInfo raw = _model.GetModelInfo();
            return new ModelInfo
            {
                FilePath = raw.FilePath ?? string.Empty,
                FileName = FileNameOf(raw.FilePath),
                EtabsVersion = raw.EtabsVersion ?? string.Empty,
                EtabsVersionNumber = raw.EtabsVersionNumber,
                IsLocked = raw.IsLocked,
                Units = EtabsConventions.ParseUnits(raw.UnitsName),
                ProcessId = _etabsProcessId,
                BridgeVersion = BridgeInfo.Version,
            };
        }

        public StoriesResult GetStories()
        {
            RawModelInfo info = _model.GetModelInfo();
            RawStories raw = _model.GetStories();
            return new StoriesResult
            {
                Units = EtabsConventions.ParseUnits(info.UnitsName),
                BaseElevation = raw.BaseElevation,
                Stories = NormalizeStories(raw),
            };
        }

        public GridsResult GetGrids() => new GridsResult
        {
            Units = CurrentUnits(),
            GridSystems = _model.GetGridSystems(),
        };

        public JointsResult GetJoints() => new JointsResult
        {
            Units = CurrentUnits(),
            Joints = _model.GetJoints(),
        };

        public FramesResult GetFrames() => new FramesResult
        {
            Units = CurrentUnits(),
            Frames = _model.GetFrames(),
        };

        public AreasResult GetAreas()
        {
            UnitsInfo units = CurrentUnits();
            IReadOnlyList<Joint> joints = _model.GetJoints();
            return new AreasResult
            {
                Units = units,
                Areas = ResolveAreaPoints(_model.GetAreas(), joints),
            };
        }

        /// <summary>Reads the full geometry once; joints are read a single time and shared.</summary>
        public GeometrySnapshot GetSnapshot()
        {
            ModelInfo model = GetModelInfo();
            RawStories rawStories = _model.GetStories();
            IReadOnlyList<Joint> joints = _model.GetJoints();
            return new GeometrySnapshot
            {
                Model = model,
                Units = model.Units,
                BaseElevation = rawStories.BaseElevation,
                Stories = NormalizeStories(rawStories),
                GridSystems = _model.GetGridSystems(),
                Joints = joints,
                Frames = _model.GetFrames(),
                Areas = ResolveAreaPoints(_model.GetAreas(), joints),
            };
        }

        /// <summary>
        /// Orders stories bottom to top and drops the base level if the API reported it as
        /// a story (zero height at the base elevation); the base is exposed as BaseElevation.
        /// </summary>
        internal static IReadOnlyList<Story> NormalizeStories(RawStories raw)
        {
            return (raw.Stories ?? Array.Empty<Story>())
                .Where(s => !(Math.Abs(s.Height) < ElevationTolerance && Math.Abs(s.Elevation - raw.BaseElevation) < ElevationTolerance))
                .OrderBy(s => s.Elevation)
                .ToList();
        }

        /// <summary>
        /// Fills <see cref="AreaObject.Points"/> from joint coordinates. Throws if an area
        /// references a joint that does not exist, since that signals an inconsistent read.
        /// </summary>
        internal static IReadOnlyList<AreaObject> ResolveAreaPoints(IReadOnlyList<AreaObject> areas, IReadOnlyList<Joint> joints)
        {
            var byName = new Dictionary<string, Joint>(joints.Count, StringComparer.Ordinal);
            foreach (Joint j in joints)
            {
                byName[j.Name] = j;
            }

            foreach (AreaObject area in areas)
            {
                if (area.Points.Count == area.Joints.Count && area.Joints.Count > 0)
                {
                    continue; // adapter already resolved them
                }

                var points = new List<Point3>(area.Joints.Count);
                foreach (string jointName in area.Joints)
                {
                    if (!byName.TryGetValue(jointName, out Joint? j))
                    {
                        throw new EtabsApiException(
                            "AreaObj.GetPoints",
                            $"area '{area.Name}' references joint '{jointName}', which PointObj.GetAllPoints did not return");
                    }

                    points.Add(new Point3(j.X, j.Y, j.Z));
                }

                area.Points = points;
            }

            return areas;
        }

        /// <summary>File name from a Windows or POSIX path, independent of the OS running this code.</summary>
        internal static string FileNameOf(string? path)
        {
            if (string.IsNullOrEmpty(path))
            {
                return string.Empty;
            }

            int slash = path!.LastIndexOfAny(new[] { '\\', '/' });
            return slash >= 0 ? path.Substring(slash + 1) : path;
        }

        private UnitsInfo CurrentUnits() => EtabsConventions.ParseUnits(_model.GetModelInfo().UnitsName);
    }
}
