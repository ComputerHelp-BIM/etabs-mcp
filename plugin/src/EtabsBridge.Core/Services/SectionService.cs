using System;
using System.Collections.Generic;
using System.Linq;
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
        /// <summary>Normalized frame shape -> dimension getters (full API paths) to try, newest first.</summary>
        private static readonly Dictionary<string, string[]> DimensionGetters = new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            ["Rectangular"] = new[] { "PropFrame.GetRectangle" },
            ["Circle"] = new[] { "PropFrame.GetCircle" },
            ["I"] = new[] { "PropFrame.GetISection_1", "PropFrame.GetISection" },
            ["Box"] = new[] { "PropFrame.GetTube_1", "PropFrame.GetTube" },
            ["Pipe"] = new[] { "PropFrame.GetPipe" },
            ["Tee"] = new[] { "PropFrame.GetTee_1", "PropFrame.GetTee", "PropFrame.GetConcreteTee" },
            ["Angle"] = new[] { "PropFrame.GetAngle_1", "PropFrame.GetAngle", "PropFrame.GetConcreteL" },
            ["Channel"] = new[] { "PropFrame.GetChannel_1", "PropFrame.GetChannel" },
        };

        private readonly IEtabsModel _model;
        private LateBoundApi _api;

        public SectionService(IEtabsModel model)
        {
            _model = model ?? throw new ArgumentNullException(nameof(model));
            _api = new LateBoundApi(model);
        }

        public SectionsResult GetSections()
        {
            _api = new LateBoundApi(_model); // fresh warnings per read
            var result = new SectionsResult
            {
                Units = EtabsConventions.ParseUnits(_model.GetModelInfo().UnitsName),
                Materials = ReadMaterials(),
                FrameSections = ReadFrameSections(),
                AreaSections = ReadAreaSections(),
            };
            result.Warnings = _api.Warnings.ToArray();
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
                    ApiCallResult? dims = _api.FirstAvailable(getters, $"frame section '{name}'", name);
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
                    s.Material = Text(r, "MatProp") ?? string.Empty;
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

        private IEnumerable<string> NameList(string method) => _api.NameList(method);

        private ApiCallResult? Call(string method, params object?[] inputs) => _api.Call(method, inputs);

        private ApiCallResult? Call(string method, bool quiet, params object?[] inputs) => _api.Call(method, quiet, inputs);

        private void Warn(string message) => _api.Warn(message);

        private static double? Number(ApiCallResult? r, string key) => LateBoundApi.Number(r, key);

        private static string? Text(ApiCallResult? r, string key) => LateBoundApi.Text(r, key);

        private static string ColorOf(ApiCallResult? r, string key) => LateBoundApi.Color(r, key);
    }
}
