using System;
using System.Collections.Generic;
using System.Globalization;
using EtabsBridge.Core.Model;
using EtabsBridge.Core.Ports;
using EtabsBridge.Core.Rpc;

namespace EtabsBridge.Core.Services
{
    /// <summary>
    /// Reads materials, frame sections and area sections.
    ///
    /// Unlike the geometry adapter, this service calls the CSI API by method NAME through
    /// <see cref="ApiInvoker.InvokeWithInputs"/>. The material/section API has many shape-specific
    /// methods whose exact signatures vary between ETABS versions (e.g. GetISection vs GetISection_1);
    /// late binding lets a missing or changed method degrade to a warning and null values instead of
    /// a build or load failure, and keeps all of this logic unit-testable without ETABS.
    ///
    /// Must run on the ETABS API thread (see <see cref="IEtabsDispatcher"/>).
    /// </summary>
    public sealed class SectionService
    {
        private const int MaxWarnings = 50;

        /// <summary>Normalized frame shape -> dimension getters to try, newest first.</summary>
        private static readonly Dictionary<string, string[]> DimensionGetters = new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            ["Rectangular"] = new[] { "GetRectangle" },
            ["Circle"] = new[] { "GetCircle" },
            ["I"] = new[] { "GetISection_1", "GetISection" },
            ["Box"] = new[] { "GetTube_1", "GetTube" },
            ["Pipe"] = new[] { "GetPipe" },
            ["Tee"] = new[] { "GetTee_1", "GetTee", "GetConcreteTee" },
            ["Angle"] = new[] { "GetAngle_1", "GetAngle", "GetConcreteL" },
            ["Channel"] = new[] { "GetChannel_1", "GetChannel" },
        };

        private readonly IEtabsModel _model;
        private readonly ApiInvoker _api;
        private readonly List<string> _warnings = new List<string>();
        private readonly HashSet<string> _missingMethods = new HashSet<string>(StringComparer.Ordinal);

        public SectionService(IEtabsModel model)
        {
            _model = model ?? throw new ArgumentNullException(nameof(model));
            _api = new ApiInvoker(model.ApiRoot, model.ApiRootType, () => false); // read-only by construction
        }

        public SectionsResult GetSections()
        {
            _warnings.Clear();
            _missingMethods.Clear();
            var result = new SectionsResult
            {
                Units = EtabsConventions.ParseUnits(_model.GetModelInfo().UnitsName),
                Materials = ReadMaterials(),
                FrameSections = ReadFrameSections(),
                AreaSections = ReadAreaSections(),
            };
            result.Warnings = _warnings.ToArray();
            return result;
        }

        // ---------------------------------------------------------------- materials

        private List<Material> ReadMaterials()
        {
            var list = new List<Material>();
            foreach (string name in NameList("PropMaterial.GetNameList"))
            {
                var m = new Material { Name = name };
                ApiCallResult? basic = Call("PropMaterial.GetMaterial", name);
                if (basic != null)
                {
                    m.Type = NormalizeMaterialType(Text(basic, "MatType"));
                    m.Color = ColorOf(basic, "Color");
                }

                ApiCallResult? iso = Call("PropMaterial.GetMPIsotropic", quiet: true, name);
                if (iso != null)
                {
                    m.E = Number(iso, "E");
                    m.Poisson = Number(iso, "U");
                    m.ThermalCoefficient = Number(iso, "A");
                }
                else
                {
                    // Rebar/tendon materials are uniaxial.
                    ApiCallResult? uni = Call("PropMaterial.GetMPUniaxial", quiet: true, name);
                    if (uni != null)
                    {
                        m.E = Number(uni, "E");
                        m.ThermalCoefficient = Number(uni, "A");
                    }
                }

                ApiCallResult? weight = Call("PropMaterial.GetWeightAndMass", name);
                if (weight != null)
                {
                    m.UnitWeight = Number(weight, "W");
                }

                switch (m.Type)
                {
                    case "Concrete":
                        m.Fc = Number(Call("PropMaterial.GetOConcrete_1", name), "Fc");
                        break;
                    case "Steel":
                    case "ColdFormed":
                        ApiCallResult? steel = Call("PropMaterial.GetOSteel_1", name);
                        m.Fy = Number(steel, "Fy");
                        m.Fu = Number(steel, "Fu");
                        break;
                    case "Rebar":
                        ApiCallResult? rebar = Call("PropMaterial.GetORebar_1", name);
                        m.Fy = Number(rebar, "Fy");
                        m.Fu = Number(rebar, "Fu");
                        break;
                    case "Tendon":
                        ApiCallResult? tendon = Call("PropMaterial.GetOTendon_1", name);
                        m.Fy = Number(tendon, "Fy");
                        m.Fu = Number(tendon, "Fu");
                        break;
                }

                list.Add(m);
            }

            return list;
        }

        // ---------------------------------------------------------------- frame sections

        private List<FrameSection> ReadFrameSections()
        {
            var list = new List<FrameSection>();
            foreach (string name in NameList("PropFrame.GetNameList"))
            {
                var s = new FrameSection { Name = name };

                ApiCallResult? type = Call("PropFrame.GetTypeOAPI", name);
                s.EtabsType = Text(type, "PropType") ?? string.Empty;
                s.Shape = NormalizeFrameShape(s.EtabsType);

                if (DimensionGetters.TryGetValue(s.Shape, out string[]? getters))
                {
                    ApiCallResult? dims = FirstAvailable(getters, name);
                    if (dims != null)
                    {
                        s.Material = Text(dims, "MatProp") ?? string.Empty;
                        s.Color = ColorOf(dims, "Color");
                        s.Depth = Number(dims, "T3");
                        s.Width = s.Shape == "Circle" || s.Shape == "Pipe" ? s.Depth : Number(dims, "T2");
                        s.FlangeThickness = Number(dims, "Tf");
                        s.WebThickness = Number(dims, "Tw") ?? Number(dims, "TwF");
                        if (s.Shape == "I")
                        {
                            s.BottomWidth = Number(dims, "T2b");
                            s.BottomFlangeThickness = Number(dims, "Tfb");
                        }
                    }
                }

                if (s.Material.Length == 0)
                {
                    s.Material = Text(Call("PropFrame.GetMaterial", name), "MatProp") ?? string.Empty;
                }

                ApiCallResult? props = Call("PropFrame.GetSectProps", name);
                if (props != null)
                {
                    s.Properties = new SectionProperties
                    {
                        Area = Number(props, "Area") ?? 0,
                        As2 = Number(props, "As2") ?? 0,
                        As3 = Number(props, "As3") ?? 0,
                        Torsion = Number(props, "Torsion") ?? 0,
                        I22 = Number(props, "I22") ?? 0,
                        I33 = Number(props, "I33") ?? 0,
                        S22 = Number(props, "S22") ?? 0,
                        S33 = Number(props, "S33") ?? 0,
                        Z22 = Number(props, "Z22") ?? 0,
                        Z33 = Number(props, "Z33") ?? 0,
                        R22 = Number(props, "R22") ?? 0,
                        R33 = Number(props, "R33") ?? 0,
                    };
                }

                list.Add(s);
            }

            return list;
        }

        private ApiCallResult? FirstAvailable(string[] getters, string name)
        {
            foreach (string getter in getters)
            {
                string method = "PropFrame." + getter;
                ApiCallResult? result = Call(method, quiet: true, name);
                if (result != null)
                {
                    return result;
                }
            }

            Warn($"No dimension getter worked for frame section '{name}' (tried {string.Join(", ", getters)}).");
            return null;
        }

        // ---------------------------------------------------------------- area sections

        private List<AreaSection> ReadAreaSections()
        {
            var list = new List<AreaSection>();
            foreach (string name in NameList("PropArea.GetNameList"))
            {
                var s = new AreaSection { Name = name };

                // A property is exactly one of wall/slab/deck; the getters for the other kinds fail.
                ApiCallResult? r;
                if ((r = Call("PropArea.GetWall", quiet: true, name)) != null)
                {
                    s.Kind = "Wall";
                    s.SubType = Text(r, "WallPropType") ?? string.Empty;
                }
                else if ((r = Call("PropArea.GetSlab", quiet: true, name)) != null)
                {
                    s.Kind = "Slab";
                    s.SubType = Text(r, "SlabType") ?? string.Empty;
                }
                else if ((r = Call("PropArea.GetDeck", quiet: true, name)) != null)
                {
                    s.Kind = "Deck";
                    s.SubType = Text(r, "DeckType") ?? string.Empty;
                }

                if (r != null)
                {
                    s.ShellType = Text(r, "ShellType") ?? string.Empty;
                    s.Material = Text(r, "MatProp") ?? Text(r, "DeckMatProp") ?? string.Empty;
                    s.Thickness = Number(r, "Thickness");
                    s.Color = ColorOf(r, "color");
                }
                else
                {
                    Warn($"Area section '{name}' is not a wall, slab or deck property (or its getter failed).");
                }

                list.Add(s);
            }

            return list;
        }

        // ---------------------------------------------------------------- normalization (public for tests and reuse)

        public static string NormalizeMaterialType(string? etabsName)
        {
            switch ((etabsName ?? string.Empty).ToLowerInvariant())
            {
                case "concrete": return "Concrete";
                case "steel": return "Steel";
                case "rebar": return "Rebar";
                case "tendon": return "Tendon";
                case "aluminum": return "Aluminum";
                case "coldformed": return "ColdFormed";
                case "masonry": return "Masonry";
                case "nodesign": return "NoDesign";
                default: return "Other";
            }
        }

        public static string NormalizeFrameShape(string? etabsType)
        {
            string t = (etabsType ?? string.Empty).ToLowerInvariant();
            switch (t)
            {
                case "rectangular":
                case "concreterectangular":
                    return "Rectangular";
                case "circle":
                case "concretecircle":
                    return "Circle";
                case "i":
                case "isection":
                    return "I";
                case "box":
                case "tube":
                    return "Box";
                case "pipe":
                    return "Pipe";
                case "t":
                case "tee":
                case "concretetee":
                    return "Tee";
                case "angle":
                case "concretel":
                    return "Angle";
                case "channel":
                    return "Channel";
                case "dblangle":
                    return "DoubleAngle";
                case "dbchannel":
                    return "DoubleChannel";
                case "sd":
                    return "SectionDesigner";
                case "variable":
                case "nonprismatic":
                    return "Nonprismatic";
                case "auto":
                    return "AutoSelect";
                case "general":
                    return "General";
                default:
                    return "Other";
            }
        }

        // ---------------------------------------------------------------- late-binding helpers

        private IEnumerable<string> NameList(string method)
        {
            ApiCallResult? r = Call(method);
            if (r == null)
            {
                return Array.Empty<string>();
            }

            return r.Outputs.TryGetValue("MyName", out object? names) && names is string[] array ? array : Array.Empty<string>();
        }

        private ApiCallResult? Call(string method, params object?[] inputs) => Call(method, false, inputs);

        /// <summary>
        /// Calls an API method by name. Returns null (and records a warning unless <paramref name="quiet"/>)
        /// when the method is missing, throws, or returns a non-zero status.
        /// </summary>
        private ApiCallResult? Call(string method, bool quiet, params object?[] inputs)
        {
            try
            {
                ApiCallResult r = _api.InvokeWithInputs(method, inputs);
                if (r.ReturnValue is int rc && rc != 0)
                {
                    if (!quiet)
                    {
                        Warn($"{method}({Describe(inputs)}) returned {rc}.");
                    }

                    return null;
                }

                return r;
            }
            catch (BridgeException ex) when (ex.Status == 404 || ex.Status == 400)
            {
                // Signature/method not present in this ETABS version: report once per method.
                if (!quiet && _missingMethods.Add(method))
                {
                    Warn($"{method} is not available in this ETABS version: {ex.Message}");
                }

                return null;
            }
            catch (EtabsApiException ex)
            {
                if (!quiet)
                {
                    Warn(ex.Message);
                }

                return null;
            }
        }

        private void Warn(string message)
        {
            if (_warnings.Count < MaxWarnings)
            {
                _warnings.Add(message);
            }
            else if (_warnings.Count == MaxWarnings)
            {
                _warnings.Add("(more warnings omitted)");
            }
        }

        private static string Describe(object?[] inputs) =>
            string.Join(", ", Array.ConvertAll(inputs, i => Convert.ToString(i, CultureInfo.InvariantCulture)));

        private static double? Number(ApiCallResult? r, string key)
        {
            if (r == null || !r.Outputs.TryGetValue(key, out object? v) || v == null)
            {
                return null;
            }

            switch (v)
            {
                case double d:
                    return double.IsNaN(d) || double.IsInfinity(d) ? (double?)null : d;
                case float f:
                    return f;
                case int i:
                    return i;
                default:
                    return null;
            }
        }

        private static string? Text(ApiCallResult? r, string key) =>
            r != null && r.Outputs.TryGetValue(key, out object? v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : null;

        private static string ColorOf(ApiCallResult? r, string key) =>
            r != null && r.Outputs.TryGetValue(key, out object? v) && v is int color ? EtabsConventions.OleColorToHex(color) : "#808080";
    }
}
