using System;
using System.Collections.Generic;
using EtabsBridge.Core;
using EtabsBridge.Core.Model;
using EtabsBridge.Core.Ports;
using EtabsBridge.Core.Services;
using ETABSv1;

namespace EtabsBridge.Etabs
{
    /// <summary>
    /// <see cref="IEtabsModel"/> over the CSI OAPI (ETABSv1). Each method is a thin
    /// translation of parallel API arrays into DTOs; every return code is checked.
    ///
    /// Threading: call only on the thread that owns <see cref="cSapModel"/> (the ETABS
    /// UI thread inside a plugin). <see cref="Core.Http.BridgeApi"/> takes care of that.
    /// </summary>
    public sealed class EtabsApiModel : IEtabsModel
    {
        private readonly cSapModel _sap;

        public EtabsApiModel(cSapModel sapModel)
        {
            _sap = sapModel ?? throw new ArgumentNullException(nameof(sapModel));
        }

        public object ApiRoot => _sap;

        public Type ApiRootType => typeof(cSapModel);

        public RawModelInfo GetModelInfo()
        {
            string version = string.Empty;
            double versionNumber = 0;
            EtabsApiException.Check(_sap.GetVersion(ref version, ref versionNumber), "GetVersion");

            return new RawModelInfo
            {
                FilePath = _sap.GetModelFilename(true) ?? string.Empty,
                EtabsVersion = version ?? string.Empty,
                EtabsVersionNumber = versionNumber,
                IsLocked = _sap.GetModelIsLocked(),
                UnitsName = _sap.GetPresentUnits().ToString(),
            };
        }

        public RawStories GetStories()
        {
            double baseElevation = 0;
            int count = 0;
            string[] names = Array.Empty<string>();
            double[] elevations = Array.Empty<double>();
            double[] heights = Array.Empty<double>();
            bool[] isMaster = Array.Empty<bool>();
            string[] similarTo = Array.Empty<string>();
            bool[] spliceAbove = Array.Empty<bool>();
            double[] spliceHeight = Array.Empty<double>();
            int[] colors = Array.Empty<int>();

            EtabsApiException.Check(
                _sap.Story.GetStories_2(
                    ref baseElevation, ref count, ref names, ref elevations, ref heights,
                    ref isMaster, ref similarTo, ref spliceAbove, ref spliceHeight, ref colors),
                "Story.GetStories_2");

            var stories = new List<Story>(count);
            for (int i = 0; i < count; i++)
            {
                stories.Add(new Story
                {
                    Name = names[i],
                    Elevation = elevations[i],
                    Height = heights[i],
                    IsMaster = isMaster[i],
                    SimilarTo = EtabsConventions.EmptyToNull(similarTo[i]),
                    SpliceAbove = spliceAbove[i],
                    SpliceHeight = spliceHeight[i],
                    Color = EtabsConventions.OleColorToHex(colors[i]),
                });
            }

            return new RawStories { BaseElevation = baseElevation, Stories = stories };
        }

        public IReadOnlyList<GridSystem> GetGridSystems()
        {
            int count = 0;
            string[] names = Array.Empty<string>();
            EtabsApiException.Check(_sap.GridSys.GetNameList(ref count, ref names), "GridSys.GetNameList");

            var systems = new List<GridSystem>(count);
            for (int i = 0; i < count; i++)
            {
                double xo = 0, yo = 0, rz = 0;
                string type = string.Empty;
                int numX = 0, numY = 0;
                string[] idsX = Array.Empty<string>(), idsY = Array.Empty<string>();
                double[] ordX = Array.Empty<double>(), ordY = Array.Empty<double>();
                bool[] visX = Array.Empty<bool>(), visY = Array.Empty<bool>();
                string[] bubX = Array.Empty<string>(), bubY = Array.Empty<string>();

                EtabsApiException.Check(
                    _sap.GridSys.GetGridSys_2(
                        names[i], ref xo, ref yo, ref rz, ref type, ref numX, ref numY,
                        ref idsX, ref idsY, ref ordX, ref ordY, ref visX, ref visY, ref bubX, ref bubY),
                    "GridSys.GetGridSys_2(" + names[i] + ")");

                systems.Add(new GridSystem
                {
                    Name = names[i],
                    Type = type ?? string.Empty,
                    OriginX = xo,
                    OriginY = yo,
                    RotationDeg = rz,
                    XLines = BuildGridLines(numX, idsX, ordX, visX, bubX),
                    YLines = BuildGridLines(numY, idsY, ordY, visY, bubY),
                });
            }

            return systems;
        }

        public IReadOnlyList<Joint> GetJoints()
        {
            int count = 0;
            string[] names = Array.Empty<string>();
            double[] x = Array.Empty<double>(), y = Array.Empty<double>(), z = Array.Empty<double>();
            EtabsApiException.Check(_sap.PointObj.GetAllPoints(ref count, ref names, ref x, ref y, ref z, "Global"), "PointObj.GetAllPoints");

            var joints = new List<Joint>(count);
            for (int i = 0; i < count; i++)
            {
                string label = string.Empty, story = string.Empty;
                EtabsApiException.Check(_sap.PointObj.GetLabelFromName(names[i], ref label, ref story), "PointObj.GetLabelFromName");

                bool[] restraints = new bool[6];
                EtabsApiException.Check(_sap.PointObj.GetRestraint(names[i], ref restraints), "PointObj.GetRestraint");

                joints.Add(new Joint
                {
                    Name = names[i],
                    Label = label ?? string.Empty,
                    Story = story ?? string.Empty,
                    X = x[i],
                    Y = y[i],
                    Z = z[i],
                    Restraints = restraints != null && restraints.Length == 6 ? restraints : new bool[6],
                });
            }

            return joints;
        }

        public IReadOnlyList<FrameMember> GetFrames()
        {
            int count = 0;
            string[] names = Array.Empty<string>(), props = Array.Empty<string>(), stories = Array.Empty<string>();
            string[] p1 = Array.Empty<string>(), p2 = Array.Empty<string>();
            double[] x1 = Array.Empty<double>(), y1 = Array.Empty<double>(), z1 = Array.Empty<double>();
            double[] x2 = Array.Empty<double>(), y2 = Array.Empty<double>(), z2 = Array.Empty<double>();
            double[] angle = Array.Empty<double>();
            double[] off1X = Array.Empty<double>(), off2X = Array.Empty<double>();
            double[] off1Y = Array.Empty<double>(), off2Y = Array.Empty<double>();
            double[] off1Z = Array.Empty<double>(), off2Z = Array.Empty<double>();
            int[] cardinal = Array.Empty<int>();

            EtabsApiException.Check(
                _sap.FrameObj.GetAllFrames(
                    ref count, ref names, ref props, ref stories, ref p1, ref p2,
                    ref x1, ref y1, ref z1, ref x2, ref y2, ref z2, ref angle,
                    ref off1X, ref off2X, ref off1Y, ref off2Y, ref off1Z, ref off2Z,
                    ref cardinal, "Global"),
                "FrameObj.GetAllFrames");

            var frames = new List<FrameMember>(count);
            for (int i = 0; i < count; i++)
            {
                eFrameDesignOrientation orientation = default;
                EtabsApiException.Check(_sap.FrameObj.GetDesignOrientation(names[i], ref orientation), "FrameObj.GetDesignOrientation");

                string label = string.Empty, labelStory = string.Empty;
                EtabsApiException.Check(_sap.FrameObj.GetLabelFromName(names[i], ref label, ref labelStory), "FrameObj.GetLabelFromName");

                frames.Add(new FrameMember
                {
                    Name = names[i],
                    Label = label ?? string.Empty,
                    Story = string.IsNullOrEmpty(stories[i]) ? labelStory ?? string.Empty : stories[i],
                    Section = props[i] ?? string.Empty,
                    Type = EtabsConventions.NormalizeFrameType(orientation.ToString()),
                    Joint1 = p1[i],
                    Joint2 = p2[i],
                    Start = new Point3(x1[i], y1[i], z1[i]),
                    End = new Point3(x2[i], y2[i], z2[i]),
                    Angle = angle[i],
                    CardinalPoint = cardinal[i],
                });
            }

            return frames;
        }

        public IReadOnlyList<AreaObject> GetAreas()
        {
            int count = 0;
            string[] names = Array.Empty<string>();
            EtabsApiException.Check(_sap.AreaObj.GetNameList(ref count, ref names), "AreaObj.GetNameList");

            var areas = new List<AreaObject>(count);
            for (int i = 0; i < count; i++)
            {
                string name = names[i];

                int pointCount = 0;
                string[] points = Array.Empty<string>();
                EtabsApiException.Check(_sap.AreaObj.GetPoints(name, ref pointCount, ref points), "AreaObj.GetPoints");

                string prop = string.Empty;
                EtabsApiException.Check(_sap.AreaObj.GetProperty(name, ref prop), "AreaObj.GetProperty");

                eAreaDesignOrientation orientation = default;
                EtabsApiException.Check(_sap.AreaObj.GetDesignOrientation(name, ref orientation), "AreaObj.GetDesignOrientation");

                string label = string.Empty, story = string.Empty;
                EtabsApiException.Check(_sap.AreaObj.GetLabelFromName(name, ref label, ref story), "AreaObj.GetLabelFromName");

                var joints = new string[pointCount];
                Array.Copy(points, joints, pointCount);

                areas.Add(new AreaObject
                {
                    Name = name,
                    Label = label ?? string.Empty,
                    Story = story ?? string.Empty,
                    Section = prop ?? string.Empty,
                    Type = EtabsConventions.NormalizeAreaType(orientation.ToString()),
                    Joints = joints,
                });
            }

            return areas;
        }

        public IReadOnlyList<TableInfo> GetTables()
        {
            int count = 0;
            string[] keys = Array.Empty<string>(), names = Array.Empty<string>();
            int[] importTypes = Array.Empty<int>();
            bool[] isEmpty = Array.Empty<bool>();
            EtabsApiException.Check(
                _sap.DatabaseTables.GetAllTables(ref count, ref keys, ref names, ref importTypes, ref isEmpty),
                "DatabaseTables.GetAllTables");

            var tables = new List<TableInfo>(count);
            for (int i = 0; i < count; i++)
            {
                tables.Add(new TableInfo { Key = keys[i], Name = names[i], ImportType = importTypes[i], IsEmpty = isEmpty[i] });
            }

            return tables;
        }

        public TableData GetTable(string key, string group, IReadOnlyList<string> fields)
        {
            // An empty field list asks ETABS for all fields.
            string[] fieldKeys = fields.Count == 0 ? new[] { string.Empty } : ToArray(fields);
            int version = 0;
            string[] included = Array.Empty<string>();
            int records = 0;
            string[] data = Array.Empty<string>();

            EtabsApiException.Check(
                _sap.DatabaseTables.GetTableForDisplayArray(key, ref fieldKeys, group, ref version, ref included, ref records, ref data),
                "DatabaseTables.GetTableForDisplayArray(" + key + ")");

            return new TableData
            {
                Key = key,
                Group = group,
                Version = version,
                Fields = included,
                Rows = TableReshaper.ToRows(data, included.Length, records),
            };
        }

        private static IReadOnlyList<GridLine> BuildGridLines(int count, string[] ids, double[] ordinates, bool[] visible, string[] bubbles)
        {
            var lines = new List<GridLine>(count);
            for (int i = 0; i < count; i++)
            {
                lines.Add(new GridLine
                {
                    Id = ids[i],
                    Ordinate = ordinates[i],
                    Visible = i < visible.Length ? visible[i] : true,
                    BubbleLocation = i < bubbles.Length ? bubbles[i] ?? string.Empty : string.Empty,
                });
            }

            return lines;
        }

        private static string[] ToArray(IReadOnlyList<string> list)
        {
            var array = new string[list.Count];
            for (int i = 0; i < list.Count; i++)
            {
                array[i] = list[i];
            }

            return array;
        }
    }
}
