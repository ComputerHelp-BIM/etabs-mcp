using System;
using System.Collections.Generic;
using System.Linq;
using EtabsBridge.Core.Model;
using EtabsBridge.Core.Ports;
using EtabsBridge.Core.Rpc;

namespace EtabsBridge.Core.Services
{
    /// <summary>
    /// Reads load patterns, load cases, combinations and assigned loads (late-bound, see <see cref="LateBoundApi"/>).
    /// Assigned loads are read for the whole model with Name = "All" and ItemType = Group, which is how the
    /// CSI API returns every object's loads in one call. Must run on the ETABS API thread.
    /// </summary>
    public sealed class LoadsService
    {
        /// <summary>eItemType.Group: Name is a group name ("All" = every object).</summary>
        private const int ItemTypeGroup = 1;

        private static readonly string[] ComboTypes = { "LinearAdditive", "Envelope", "AbsoluteAdditive", "SRSS", "RangeAdditive" };

        private readonly IEtabsModel _model;

        public LoadsService(IEtabsModel model)
        {
            _model = model ?? throw new ArgumentNullException(nameof(model));
        }

        public LoadsResult GetLoads()
        {
            var api = new LateBoundApi(_model);
            var result = new LoadsResult
            {
                Units = EtabsConventions.ParseUnits(_model.GetModelInfo().UnitsName),
                Patterns = ReadPatterns(api),
                Cases = ReadCases(api),
                Combinations = ReadCombinations(api),
                FrameDistributed = ReadFrameDistributed(api),
                FramePoint = ReadFramePoint(api),
                AreaUniform = ReadAreaUniform(api),
                JointLoads = ReadJointLoads(api),
            };
            result.Warnings = api.Warnings.ToArray();
            return result;
        }

        private static List<LoadPattern> ReadPatterns(LateBoundApi api) =>
            api.NameList("LoadPatterns.GetNameList")
                .Select(name => new LoadPattern
                {
                    Name = name,
                    Type = LateBoundApi.Text(api.Call("LoadPatterns.GetLoadType", name), "MyType") ?? string.Empty,
                    SelfWeightMultiplier = LateBoundApi.Number(api.Call("LoadPatterns.GetSelfWTMultiplier", name), "SelfWTMultiplier"),
                })
                .ToList();

        private static List<LoadCase> ReadCases(LateBoundApi api) =>
            api.NameList("LoadCases.GetNameList")
                .Select(name =>
                {
                    ApiCallResult? r = api.FirstAvailable(new[] { "LoadCases.GetTypeOAPI_1", "LoadCases.GetTypeOAPI" }, $"load case '{name}'", name);
                    double? sub = LateBoundApi.Number(r, "SubType");
                    return new LoadCase
                    {
                        Name = name,
                        Type = LateBoundApi.Text(r, "CaseType") ?? string.Empty,
                        SubType = sub.HasValue ? (int)sub.Value : (int?)null,
                    };
                })
                .ToList();

        private static List<LoadCombination> ReadCombinations(LateBoundApi api) =>
            api.NameList("RespCombo.GetNameList")
                .Select(name =>
                {
                    double? type = LateBoundApi.Number(api.Call("RespCombo.GetTypeOAPI", name), "ComboType");
                    ApiCallResult? items = api.Call("RespCombo.GetCaseList", name);
                    string[] kinds = LateBoundApi.Strings(items, "CNameType");
                    string[] names = LateBoundApi.Strings(items, "CName");
                    double[] factors = LateBoundApi.Numbers(items, "SF");
                    int n = LateBoundApi.Count(kinds, names, factors);
                    return new LoadCombination
                    {
                        Name = name,
                        Type = type.HasValue && type.Value >= 0 && type.Value < ComboTypes.Length ? ComboTypes[(int)type.Value] : "Other",
                        Items = Enumerable.Range(0, n)
                            .Select(i => new CombinationItem { Kind = NormalizeComboItemKind(kinds[i]), Name = names[i], Factor = factors[i] })
                            .ToList(),
                    };
                })
                .ToList();

        private static List<FrameDistributedLoad> ReadFrameDistributed(LateBoundApi api)
        {
            ApiCallResult? r = api.Call("FrameObj.GetLoadDistributed", "All", ItemTypeGroup);
            string[] frames = LateBoundApi.Strings(r, "FrameName");
            string[] patterns = LateBoundApi.Strings(r, "LoadPat");
            double[] types = LateBoundApi.Numbers(r, "MyType");
            string[] csys = LateBoundApi.Strings(r, "CSys");
            double[] dir = LateBoundApi.Numbers(r, "Dir");
            double[] rd1 = LateBoundApi.Numbers(r, "RD1");
            double[] rd2 = LateBoundApi.Numbers(r, "RD2");
            double[] d1 = LateBoundApi.Numbers(r, "Dist1");
            double[] d2 = LateBoundApi.Numbers(r, "Dist2");
            double[] v1 = LateBoundApi.Numbers(r, "Val1");
            double[] v2 = LateBoundApi.Numbers(r, "Val2");
            int n = LateBoundApi.Count(frames, patterns, types, csys, dir, rd1, rd2, d1, d2, v1, v2);
            return Enumerable.Range(0, n)
                .Select(i => new FrameDistributedLoad
                {
                    Frame = frames[i],
                    Pattern = patterns[i],
                    LoadType = types[i] == 2 ? "Moment" : "Force",
                    CSys = csys[i],
                    Direction = (int)dir[i],
                    RelativeStart = rd1[i],
                    RelativeEnd = rd2[i],
                    DistanceStart = d1[i],
                    DistanceEnd = d2[i],
                    ValueStart = v1[i],
                    ValueEnd = v2[i],
                })
                .ToList();
        }

        private static List<FramePointLoad> ReadFramePoint(LateBoundApi api)
        {
            ApiCallResult? r = api.Call("FrameObj.GetLoadPoint", "All", ItemTypeGroup);
            string[] frames = LateBoundApi.Strings(r, "FrameName");
            string[] patterns = LateBoundApi.Strings(r, "LoadPat");
            double[] types = LateBoundApi.Numbers(r, "MyType");
            string[] csys = LateBoundApi.Strings(r, "CSys");
            double[] dir = LateBoundApi.Numbers(r, "Dir");
            double[] rel = LateBoundApi.Numbers(r, "RelDist");
            double[] dist = LateBoundApi.Numbers(r, "Dist");
            double[] val = LateBoundApi.Numbers(r, "Val");
            int n = LateBoundApi.Count(frames, patterns, types, csys, dir, rel, dist, val);
            return Enumerable.Range(0, n)
                .Select(i => new FramePointLoad
                {
                    Frame = frames[i],
                    Pattern = patterns[i],
                    LoadType = types[i] == 2 ? "Moment" : "Force",
                    CSys = csys[i],
                    Direction = (int)dir[i],
                    RelativeDistance = rel[i],
                    Distance = dist[i],
                    Value = val[i],
                })
                .ToList();
        }

        private static List<AreaUniformLoad> ReadAreaUniform(LateBoundApi api)
        {
            ApiCallResult? r = api.Call("AreaObj.GetLoadUniform", "All", ItemTypeGroup);
            string[] areas = LateBoundApi.Strings(r, "AreaName");
            string[] patterns = LateBoundApi.Strings(r, "LoadPat");
            string[] csys = LateBoundApi.Strings(r, "CSys");
            double[] dir = LateBoundApi.Numbers(r, "Dir");
            double[] val = LateBoundApi.Numbers(r, "Value");
            int n = LateBoundApi.Count(areas, patterns, csys, dir, val);
            return Enumerable.Range(0, n)
                .Select(i => new AreaUniformLoad { Area = areas[i], Pattern = patterns[i], CSys = csys[i], Direction = (int)dir[i], Value = val[i] })
                .ToList();
        }

        private static List<JointLoad> ReadJointLoads(LateBoundApi api)
        {
            ApiCallResult? r = api.Call("PointObj.GetLoadForce", "All", ItemTypeGroup);
            string[] joints = LateBoundApi.Strings(r, "PointName");
            string[] patterns = LateBoundApi.Strings(r, "LoadPat");
            string[] csys = LateBoundApi.Strings(r, "CSys");
            double[][] f = new[] { "F1", "F2", "F3", "M1", "M2", "M3" }.Select(k => LateBoundApi.Numbers(r, k)).ToArray();
            int n = LateBoundApi.Count(new Array[] { joints, patterns, csys }.Concat(f).ToArray());
            return Enumerable.Range(0, n)
                .Select(i => new JointLoad
                {
                    Joint = joints[i],
                    Pattern = patterns[i],
                    CSys = csys[i],
                    F1 = f[0][i],
                    F2 = f[1][i],
                    F3 = f[2][i],
                    M1 = f[3][i],
                    M2 = f[4][i],
                    M3 = f[5][i],
                })
                .ToList();
        }

        /// <summary>eCNameType: LoadCase = 0, LoadCombo = 1 (names or numbers accepted).</summary>
        internal static string NormalizeComboItemKind(string raw) =>
            raw == "1" || raw.Equals("LoadCombo", StringComparison.OrdinalIgnoreCase) ? "LoadCombo" : "LoadCase";
    }
}
