using System;
using System.Collections.Generic;
using System.Linq;

// Imitation of CSI Analyze / Results / Results.Setup / DesignConcrete for ResultsService tests.
// Results only include cases/combos that were selected for output, like ETABS.
namespace EtabsBridge.Core.Tests.Fakes.FakeApi
{
    public enum eItemTypeElm
    {
        ObjectElm = 0,
        Element = 1,
        GroupElm = 2,
        SelectionElm = 3,
    }

    public interface IFakeAnalyze
    {
        int GetCaseStatus(ref int NumberItems, ref string[] CaseName, ref int[] Status);
    }

    public interface IFakeResultsSetup
    {
        int DeselectAllCasesAndCombosForOutput();

        int SetCaseSelectedForOutput(string Name, bool Selected = true);

        int SetComboSelectedForOutput(string Name, bool Selected = true);
    }

    public interface IFakeResults
    {
        IFakeResultsSetup Setup { get; }

        int BaseReact(ref int NumberResults, ref string[] LoadCase, ref string[] StepType, ref double[] StepNum, ref double[] Fx, ref double[] Fy, ref double[] Fz, ref double[] Mx, ref double[] ParamMy, ref double[] Mz, ref double gx, ref double gy, ref double gz);

        int StoryDrifts(ref int NumberResults, ref string[] Story, ref string[] LoadCase, ref string[] StepType, ref double[] StepNum, ref string[] Direction, ref double[] Drift, ref string[] Label, ref double[] X, ref double[] Y, ref double[] Z);

        int JointReact(string Name, eItemTypeElm ItemTypeElm, ref int NumberResults, ref string[] Obj, ref string[] Elm, ref string[] LoadCase, ref string[] StepType, ref double[] StepNum, ref double[] F1, ref double[] F2, ref double[] F3, ref double[] M1, ref double[] M2, ref double[] M3);

        int JointDispl(string Name, eItemTypeElm ItemTypeElm, ref int NumberResults, ref string[] Obj, ref string[] Elm, ref string[] LoadCase, ref string[] StepType, ref double[] StepNum, ref double[] U1, ref double[] U2, ref double[] U3, ref double[] R1, ref double[] R2, ref double[] R3);

        int FrameForce(string Name, eItemTypeElm ItemTypeElm, ref int NumberResults, ref string[] Obj, ref double[] ObjSta, ref string[] Elm, ref double[] ElmSta, ref string[] LoadCase, ref string[] StepType, ref double[] StepNum, ref double[] P, ref double[] V2, ref double[] V3, ref double[] T, ref double[] M2, ref double[] M3);
    }

    public interface IFakeDesignConcrete
    {
        int GetSummaryResultsBeam(string Name, ref int NumberItems, ref string[] FrameName, ref double[] Location, ref string[] TopCombo, ref double[] TopArea, ref string[] BotCombo, ref double[] BotArea, ref string[] VMajorCombo, ref double[] VMajorArea, ref string[] TLCombo, ref double[] TLArea, ref string[] TTCombo, ref double[] TTArea, ref string[] ErrorSummary, ref string[] WarningSummary, eItemType ItemType = eItemType.Objects);

        // GetSummaryResultsColumn intentionally missing: columns must be absent with one warning.
    }

    public sealed class FakeAnalyze : IFakeAnalyze
    {
        public int GetCaseStatus(ref int NumberItems, ref string[] CaseName, ref int[] Status)
        {
            CaseName = new[] { "Dead", "Live", "Modal" };
            Status = new[] { 4, 4, 1 };
            NumberItems = 3;
            return 0;
        }
    }

    public sealed class FakeResultsSetup : IFakeResultsSetup
    {
        public HashSet<string> Selected { get; } = new HashSet<string>();

        public int DeselectAllCasesAndCombosForOutput()
        {
            Selected.Clear();
            return 0;
        }

        public int SetCaseSelectedForOutput(string Name, bool Selected = true)
        {
            if (Name == "Nope")
            {
                return 1;
            }

            if (Selected)
            {
                this.Selected.Add(Name);
            }

            return 0;
        }

        public int SetComboSelectedForOutput(string Name, bool Selected = true)
        {
            if (Selected)
            {
                this.Selected.Add(Name);
            }

            return 0;
        }
    }

    public sealed class FakeResults : IFakeResults
    {
        private readonly FakeResultsSetup _setup = new FakeResultsSetup();

        public IFakeResultsSetup Setup => _setup;

        private string[] Cases => new[] { "Dead", "Live", "ULS1" }.Where(_setup.Selected.Contains).ToArray();

        public int BaseReact(ref int NumberResults, ref string[] LoadCase, ref string[] StepType, ref double[] StepNum, ref double[] Fx, ref double[] Fy, ref double[] Fz, ref double[] Mx, ref double[] ParamMy, ref double[] Mz, ref double gx, ref double gy, ref double gz)
        {
            LoadCase = Cases;
            int n = LoadCase.Length;
            StepType = Enumerable.Repeat(string.Empty, n).ToArray();
            StepNum = new double[n];
            Fx = new double[n];
            Fy = new double[n];
            Fz = LoadCase.Select(c => c == "Dead" ? 1000.0 : c == "Live" ? 400.0 : 2100.0).ToArray();
            Mx = new double[n];
            ParamMy = LoadCase.Select(_ => 5.0).ToArray();
            Mz = new double[n];
            NumberResults = n;
            return 0;
        }

        public int StoryDrifts(ref int NumberResults, ref string[] Story, ref string[] LoadCase, ref string[] StepType, ref double[] StepNum, ref string[] Direction, ref double[] Drift, ref string[] Label, ref double[] X, ref double[] Y, ref double[] Z)
        {
            string[] cases = Cases;
            Story = cases.SelectMany(_ => new[] { "Story2", "Story1" }).ToArray();
            LoadCase = cases.SelectMany(c => new[] { c, c }).ToArray();
            int n = Story.Length;
            StepType = Enumerable.Repeat(string.Empty, n).ToArray();
            StepNum = new double[n];
            Direction = Enumerable.Repeat("X", n).ToArray();
            Drift = Enumerable.Range(0, n).Select(i => 0.001 * (i % 2 == 0 ? 2 : 1)).ToArray();
            Label = Enumerable.Repeat("1", n).ToArray();
            X = new double[n];
            Y = new double[n];
            Z = Story.Select(s => s == "Story2" ? 7.5 : 4.0).ToArray();
            NumberResults = n;
            return 0;
        }

        public int JointReact(string Name, eItemTypeElm ItemTypeElm, ref int NumberResults, ref string[] Obj, ref string[] Elm, ref string[] LoadCase, ref string[] StepType, ref double[] StepNum, ref double[] F1, ref double[] F2, ref double[] F3, ref double[] M1, ref double[] M2, ref double[] M3)
        {
            string[] joints = Name == "All" && ItemTypeElm == eItemTypeElm.GroupElm ? new[] { "1", "2" } : new[] { Name };
            string[] cases = Cases;
            Obj = cases.SelectMany(_ => joints).ToArray();
            LoadCase = cases.SelectMany(c => joints.Select(_ => c)).ToArray();
            int n = Obj.Length;
            Elm = Obj;
            StepType = Enumerable.Repeat(string.Empty, n).ToArray();
            StepNum = new double[n];
            F1 = new double[n];
            F2 = new double[n];
            F3 = Enumerable.Repeat(250.0, n).ToArray();
            M1 = new double[n];
            M2 = new double[n];
            M3 = new double[n];
            NumberResults = n;
            return 0;
        }

        public int JointDispl(string Name, eItemTypeElm ItemTypeElm, ref int NumberResults, ref string[] Obj, ref string[] Elm, ref string[] LoadCase, ref string[] StepType, ref double[] StepNum, ref double[] U1, ref double[] U2, ref double[] U3, ref double[] R1, ref double[] R2, ref double[] R3)
        {
            string[] cases = Cases;
            Obj = cases.Select(_ => Name == "All" ? "9" : Name).ToArray();
            LoadCase = cases;
            int n = Obj.Length;
            Elm = Obj;
            StepType = Enumerable.Repeat(string.Empty, n).ToArray();
            StepNum = new double[n];
            U1 = Enumerable.Repeat(0.012, n).ToArray();
            U2 = new double[n];
            U3 = Enumerable.Repeat(-0.003, n).ToArray();
            R1 = new double[n];
            R2 = new double[n];
            R3 = new double[n];
            NumberResults = n;
            return 0;
        }

        public int FrameForce(string Name, eItemTypeElm ItemTypeElm, ref int NumberResults, ref string[] Obj, ref double[] ObjSta, ref string[] Elm, ref double[] ElmSta, ref string[] LoadCase, ref string[] StepType, ref double[] StepNum, ref double[] P, ref double[] V2, ref double[] V3, ref double[] T, ref double[] M2, ref double[] M3)
        {
            string frame = Name == "All" ? "3" : Name;
            double[] stations = { 0, 3, 6 };
            string[] cases = Cases;
            Obj = cases.SelectMany(_ => stations.Select(__ => frame)).ToArray();
            ObjSta = cases.SelectMany(_ => stations).ToArray();
            LoadCase = cases.SelectMany(c => stations.Select(_ => c)).ToArray();
            int n = Obj.Length;
            Elm = Obj;
            ElmSta = ObjSta;
            StepType = Enumerable.Repeat(string.Empty, n).ToArray();
            StepNum = new double[n];
            P = new double[n];
            V2 = ObjSta.Select(x => 30 - 10 * x).ToArray();
            V3 = new double[n];
            T = new double[n];
            M2 = new double[n];
            M3 = ObjSta.Select(x => 5 * x * (6 - x)).ToArray();
            NumberResults = n;
            return 0;
        }
    }

    public sealed class FakeDesignConcrete : IFakeDesignConcrete
    {
        public int GetSummaryResultsBeam(string Name, ref int NumberItems, ref string[] FrameName, ref double[] Location, ref string[] TopCombo, ref double[] TopArea, ref string[] BotCombo, ref double[] BotArea, ref string[] VMajorCombo, ref double[] VMajorArea, ref string[] TLCombo, ref double[] TLArea, ref string[] TTCombo, ref double[] TTArea, ref string[] ErrorSummary, ref string[] WarningSummary, eItemType ItemType = eItemType.Objects)
        {
            FrameName = new[] { "3", "3" };
            Location = new[] { 0.0, 6.0 };
            TopCombo = new[] { "ULS1", "ULS1" };
            TopArea = new[] { 0.0012, 0.0010 };
            BotCombo = new[] { "ULS1", "ULS1" };
            BotArea = new[] { 0.0006, 0.0008 };
            VMajorCombo = new[] { "ULS1", "ULS1" };
            VMajorArea = new[] { 0.0005, 0.0004 };
            NumberItems = 2;
            return 0;
        }
    }
}
