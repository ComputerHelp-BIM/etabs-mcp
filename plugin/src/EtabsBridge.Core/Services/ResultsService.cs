using System;
using System.Collections.Generic;
using System.Linq;
using EtabsBridge.Core.Model;
using EtabsBridge.Core.Ports;
using EtabsBridge.Core.Rpc;

namespace EtabsBridge.Core.Services
{
    /// <summary>Which load cases and combinations results are requested for.</summary>
    public sealed class OutputSelection
    {
        public IReadOnlyList<string> Cases { get; set; } = Array.Empty<string>();

        public IReadOnlyList<string> Combinations { get; set; } = Array.Empty<string>();

        public bool IsEmpty => Cases.Count == 0 && Combinations.Count == 0;
    }

    /// <summary>
    /// Analysis and design results (late-bound, see <see cref="LateBoundApi"/>).
    ///
    /// Every read first selects the requested cases/combinations for output
    /// (Results.Setup.DeselectAllCasesAndCombosForOutput + SetCase/ComboSelectedForOutput). This changes
    /// the output selection of the user's ETABS session, never model data. Must run on the ETABS API thread.
    /// </summary>
    public sealed class ResultsService
    {
        /// <summary>eItemTypeElm.ObjectElm / GroupElm.</summary>
        private const int ObjectElm = 0;
        private const int GroupElm = 2;

        /// <summary>eItemType.Group, used by the design getters.</summary>
        private const int ItemTypeGroup = 1;

        private static readonly string[] StatusNames = { "Unknown", "NotRun", "CouldNotStart", "NotFinished", "Finished" };

        private readonly IEtabsModel _model;

        public ResultsService(IEtabsModel model)
        {
            _model = model ?? throw new ArgumentNullException(nameof(model));
        }

        public AnalysisStatus GetStatus()
        {
            var api = new LateBoundApi(_model);
            ApiCallResult? r = api.Call("Analyze.GetCaseStatus");
            string[] names = LateBoundApi.Strings(r, "CaseName");
            double[] status = LateBoundApi.Numbers(r, "Status");
            int n = LateBoundApi.Count(names, status);
            var result = new AnalysisStatus
            {
                IsLocked = _model.GetModelInfo().IsLocked,
                Cases = Enumerable.Range(0, n)
                    .Select(i => new CaseStatus { Name = names[i], Status = status[i] >= 1 && status[i] <= 4 ? StatusNames[(int)status[i]] : "Unknown" })
                    .ToList(),
                Combinations = api.NameList("RespCombo.GetNameList"),
            };
            result.Warnings = api.Warnings.ToArray();
            return result;
        }

        public ResultRows<BaseReactionRow> GetBaseReactions(OutputSelection selection) =>
            Read(selection, api =>
            {
                ApiCallResult? r = api.Call("Results.BaseReact");
                string[] cases = LateBoundApi.Strings(r, "LoadCase");
                string[] stepType = LateBoundApi.Strings(r, "StepType");
                double[] stepNum = LateBoundApi.Numbers(r, "StepNum");
                double[] fx = LateBoundApi.Numbers(r, "Fx");
                double[] fy = LateBoundApi.Numbers(r, "Fy");
                double[] fz = LateBoundApi.Numbers(r, "Fz");
                double[] mx = LateBoundApi.Numbers(r, "Mx");
                double[] my = First(LateBoundApi.Numbers(r, "ParamMy"), LateBoundApi.Numbers(r, "My"));
                double[] mz = LateBoundApi.Numbers(r, "Mz");
                int n = LateBoundApi.Count(cases, stepType, stepNum, fx, fy, fz, mx, my, mz);
                return Enumerable.Range(0, n)
                    .Select(i => new BaseReactionRow { LoadCase = cases[i], StepType = stepType[i], StepNum = stepNum[i], Fx = fx[i], Fy = fy[i], Fz = fz[i], Mx = mx[i], My = my[i], Mz = mz[i] })
                    .ToList();
            });

        public ResultRows<StoryDriftRow> GetStoryDrifts(OutputSelection selection) =>
            Read(selection, api =>
            {
                ApiCallResult? r = api.Call("Results.StoryDrifts");
                string[] story = LateBoundApi.Strings(r, "Story");
                string[] cases = LateBoundApi.Strings(r, "LoadCase");
                string[] stepType = LateBoundApi.Strings(r, "StepType");
                double[] stepNum = LateBoundApi.Numbers(r, "StepNum");
                string[] dir = LateBoundApi.Strings(r, "Direction");
                double[] drift = LateBoundApi.Numbers(r, "Drift");
                string[] label = LateBoundApi.Strings(r, "Label");
                double[] x = LateBoundApi.Numbers(r, "X");
                double[] y = LateBoundApi.Numbers(r, "Y");
                double[] z = LateBoundApi.Numbers(r, "Z");
                int n = LateBoundApi.Count(story, cases, stepType, stepNum, dir, drift, label, x, y, z);
                return Enumerable.Range(0, n)
                    .Select(i => new StoryDriftRow
                    {
                        Story = story[i],
                        LoadCase = cases[i],
                        StepType = stepType[i],
                        StepNum = stepNum[i],
                        Direction = dir[i],
                        Drift = drift[i],
                        Label = label[i],
                        X = x[i],
                        Y = y[i],
                        Z = z[i],
                    })
                    .ToList();
            });

        /// <param name="selection">Cases/combinations to report.</param>
        /// <param name="joint">One joint, or null for all joints.</param>
        public ResultRows<JointReactionRow> GetJointReactions(OutputSelection selection, string? joint) =>
            Read(selection, api =>
            {
                ApiCallResult? r = api.Call("Results.JointReact", joint ?? "All", joint == null ? GroupElm : ObjectElm);
                string[] obj = LateBoundApi.Strings(r, "Obj");
                string[] cases = LateBoundApi.Strings(r, "LoadCase");
                string[] stepType = LateBoundApi.Strings(r, "StepType");
                double[] stepNum = LateBoundApi.Numbers(r, "StepNum");
                double[][] v = new[] { "F1", "F2", "F3", "M1", "M2", "M3" }.Select(k => LateBoundApi.Numbers(r, k)).ToArray();
                int n = LateBoundApi.Count(new Array[] { obj, cases, stepType, stepNum }.Concat(v).ToArray());
                return Enumerable.Range(0, n)
                    .Select(i => new JointReactionRow
                    {
                        Joint = obj[i],
                        LoadCase = cases[i],
                        StepType = stepType[i],
                        StepNum = stepNum[i],
                        F1 = v[0][i],
                        F2 = v[1][i],
                        F3 = v[2][i],
                        M1 = v[3][i],
                        M2 = v[4][i],
                        M3 = v[5][i],
                    })
                    .ToList();
            });

        /// <param name="selection">Cases/combinations to report.</param>
        /// <param name="joint">One joint, or null for all joints.</param>
        public ResultRows<JointDisplacementRow> GetJointDisplacements(OutputSelection selection, string? joint) =>
            Read(selection, api =>
            {
                ApiCallResult? r = api.Call("Results.JointDispl", joint ?? "All", joint == null ? GroupElm : ObjectElm);
                string[] obj = LateBoundApi.Strings(r, "Obj");
                string[] cases = LateBoundApi.Strings(r, "LoadCase");
                string[] stepType = LateBoundApi.Strings(r, "StepType");
                double[] stepNum = LateBoundApi.Numbers(r, "StepNum");
                double[][] v = new[] { "U1", "U2", "U3", "R1", "R2", "R3" }.Select(k => LateBoundApi.Numbers(r, k)).ToArray();
                int n = LateBoundApi.Count(new Array[] { obj, cases, stepType, stepNum }.Concat(v).ToArray());
                return Enumerable.Range(0, n)
                    .Select(i => new JointDisplacementRow
                    {
                        Joint = obj[i],
                        LoadCase = cases[i],
                        StepType = stepType[i],
                        StepNum = stepNum[i],
                        U1 = v[0][i],
                        U2 = v[1][i],
                        U3 = v[2][i],
                        R1 = v[3][i],
                        R2 = v[4][i],
                        R3 = v[5][i],
                    })
                    .ToList();
            });

        /// <param name="selection">Cases/combinations to report.</param>
        /// <param name="frame">One frame, or null for all frames (can be very large; page it).</param>
        public ResultRows<FrameForceRow> GetFrameForces(OutputSelection selection, string? frame) =>
            Read(selection, api =>
            {
                ApiCallResult? r = api.Call("Results.FrameForce", frame ?? "All", frame == null ? GroupElm : ObjectElm);
                string[] obj = LateBoundApi.Strings(r, "Obj");
                double[] sta = LateBoundApi.Numbers(r, "ObjSta");
                string[] cases = LateBoundApi.Strings(r, "LoadCase");
                string[] stepType = LateBoundApi.Strings(r, "StepType");
                double[] stepNum = LateBoundApi.Numbers(r, "StepNum");
                double[][] v = new[] { "P", "V2", "V3", "T", "M2", "M3" }.Select(k => LateBoundApi.Numbers(r, k)).ToArray();
                int n = LateBoundApi.Count(new Array[] { obj, sta, cases, stepType, stepNum }.Concat(v).ToArray());
                return Enumerable.Range(0, n)
                    .Select(i => new FrameForceRow
                    {
                        Frame = obj[i],
                        Station = sta[i],
                        LoadCase = cases[i],
                        StepType = stepType[i],
                        StepNum = stepNum[i],
                        P = v[0][i],
                        V2 = v[1][i],
                        V3 = v[2][i],
                        T = v[3][i],
                        M2 = v[4][i],
                        M3 = v[5][i],
                    })
                    .ToList();
            });

        /// <summary>Required reinforcement from concrete frame design (beams and columns of the whole model).</summary>
        public ResultRows<ConcreteDesignRow> GetConcreteDesign()
        {
            var api = new LateBoundApi(_model);
            var rows = new List<ConcreteDesignRow>();

            ApiCallResult? beams = api.Call("DesignConcrete.GetSummaryResultsBeam", "All", ItemTypeGroup);
            {
                string[] frame = LateBoundApi.Strings(beams, "FrameName");
                double[] loc = LateBoundApi.Numbers(beams, "Location");
                string[] topCombo = LateBoundApi.Strings(beams, "TopCombo");
                double[] top = LateBoundApi.Numbers(beams, "TopArea");
                double[] bot = LateBoundApi.Numbers(beams, "BotArea");
                double[] shear = LateBoundApi.Numbers(beams, "VMajorArea");
                int n = LateBoundApi.Count(frame, loc, topCombo, top, bot);
                for (int i = 0; i < n; i++)
                {
                    rows.Add(new ConcreteDesignRow
                    {
                        Frame = frame[i],
                        Kind = "Beam",
                        Location = loc[i],
                        TopArea = top[i],
                        BottomArea = bot[i],
                        ShearAreaPerLength = i < shear.Length ? shear[i] : (double?)null,
                        Combo = topCombo[i],
                    });
                }
            }

            ApiCallResult? columns = api.Call("DesignConcrete.GetSummaryResultsColumn", "All", ItemTypeGroup);
            {
                string[] frame = LateBoundApi.Strings(columns, "FrameName");
                double[] loc = LateBoundApi.Numbers(columns, "Location");
                string[] combo = LateBoundApi.Strings(columns, "PMMCombo");
                double[] area = LateBoundApi.Numbers(columns, "PMMArea");
                double[] ratio = LateBoundApi.Numbers(columns, "PMMRatio");
                double[] shear = LateBoundApi.Numbers(columns, "AVMajor");
                int n = LateBoundApi.Count(frame, loc, combo, area);
                for (int i = 0; i < n; i++)
                {
                    rows.Add(new ConcreteDesignRow
                    {
                        Frame = frame[i],
                        Kind = "Column",
                        Location = loc[i],
                        LongitudinalArea = area[i],
                        Ratio = i < ratio.Length ? ratio[i] : (double?)null,
                        ShearAreaPerLength = i < shear.Length ? shear[i] : (double?)null,
                        Combo = combo[i],
                    });
                }
            }

            return new ResultRows<ConcreteDesignRow>
            {
                Units = Units(),
                Rows = rows,
                TotalRows = rows.Count,
                Warnings = api.Warnings.ToArray(),
            };
        }

        private ResultRows<T> Read<T>(OutputSelection selection, Func<LateBoundApi, List<T>> read)
        {
            if (selection.IsEmpty)
            {
                throw new BridgeException(400, ErrorCodes.BadRequest, "Select at least one load case (cases=...) or combination (combos=...). See /results/status.");
            }

            var api = new LateBoundApi(_model);
            api.Call("Results.Setup.DeselectAllCasesAndCombosForOutput");
            foreach (string c in selection.Cases)
            {
                api.Call("Results.Setup.SetCaseSelectedForOutput", c);
            }

            foreach (string c in selection.Combinations)
            {
                api.Call("Results.Setup.SetComboSelectedForOutput", c);
            }

            List<T> rows = read(api);
            if (rows.Count == 0 && !_model.GetModelInfo().IsLocked)
            {
                api.Warn("The model is not locked, so it has probably not been analysed: run the analysis in ETABS first.");
            }

            return new ResultRows<T>
            {
                Units = Units(),
                Cases = selection.Cases,
                Combinations = selection.Combinations,
                Rows = rows,
                TotalRows = rows.Count,
                Warnings = api.Warnings.ToArray(),
            };
        }

        private UnitsInfo Units() => EtabsConventions.ParseUnits(_model.GetModelInfo().UnitsName);

        private static double[] First(double[] a, double[] b) => a.Length > 0 ? a : b;
    }
}
