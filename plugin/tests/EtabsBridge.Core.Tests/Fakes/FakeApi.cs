using System;

// A tiny imitation of the CSI API object model (interfaces with ref parameters,
// enums, sub-objects) for testing the reflective ApiInvoker.
namespace EtabsBridge.Core.Tests.Fakes.FakeApi
{
    public enum eOrientation
    {
        Column = 1,
        Beam = 2,
    }

    public interface IFakeSapModel
    {
        IFakeFrameObj FrameObj { get; }

        IFakeNullObj Broken { get; }

        IFakePropMaterial PropMaterial { get; }

        IFakePropFrame PropFrame { get; }

        IFakePropArea PropArea { get; }

        IFakeLoadPatterns LoadPatterns { get; }

        IFakeLoadCases LoadCases { get; }

        IFakeRespCombo RespCombo { get; }

        IFakeAreaObj AreaObj { get; }

        IFakePointObj PointObj { get; }

        IFakeAnalyze Analyze { get; }

        IFakeResults Results { get; }

        IFakeDesignConcrete DesignConcrete { get; }

        string GetModelFilename(bool IncludePath = true);

        int GetVersion(ref string Version, ref double MyVersionNumber);
    }

    public interface IFakeNullObj
    {
        int GetNothing();
    }

    public interface IFakeFrameObj
    {
        int GetSection(string Name, ref string PropName, ref string SAuto);

        int SetSection(string Name, string PropName);

        int GetNameList(ref int NumberNames, ref string[] MyName);

        int GetDesignOrientation(string Name, ref eOrientation DesignOrientation);

        int CountByType(eOrientation Type);

        int GetThrows(string Name);

        int SetPoints(string Name, double[] Coordinates);

        int GetLoadDistributed(string Name, ref int NumberItems, ref string[] FrameName, ref string[] LoadPat, ref int[] MyType, ref string[] CSys, ref int[] Dir, ref double[] RD1, ref double[] RD2, ref double[] Dist1, ref double[] Dist2, ref double[] Val1, ref double[] Val2, eItemType ItemType = eItemType.Objects);

        // GetLoadPoint intentionally missing: must yield an empty list plus one warning.
    }

    public sealed class FakeSapModel : IFakeSapModel
    {
        public FakeFrameObj Frames { get; } = new FakeFrameObj();

        public IFakeFrameObj FrameObj => Frames;

        public IFakeNullObj Broken => null!;

        public IFakePropMaterial PropMaterial { get; } = new FakePropMaterial();

        public IFakePropFrame PropFrame { get; } = new FakePropFrame();

        public IFakePropArea PropArea { get; } = new FakePropArea();

        public IFakeLoadPatterns LoadPatterns { get; } = new FakeLoadPatterns();

        public IFakeLoadCases LoadCases { get; } = new FakeLoadCases();

        public IFakeRespCombo RespCombo { get; } = new FakeRespCombo();

        public IFakeAreaObj AreaObj { get; } = new FakeAreaObj();

        public IFakePointObj PointObj { get; } = new FakePointObj();

        public IFakeAnalyze Analyze { get; } = new FakeAnalyze();

        public IFakeResults Results { get; } = new FakeResults();

        public IFakeDesignConcrete DesignConcrete { get; } = new FakeDesignConcrete();

        public string GetModelFilename(bool IncludePath = true) => IncludePath ? @"C:\M\Sample.EDB" : "Sample.EDB";

        public int GetVersion(ref string Version, ref double MyVersionNumber)
        {
            Version = "22.0.0";
            MyVersionNumber = 22.0;
            return 0;
        }
    }

    public sealed class FakeFrameObj : IFakeFrameObj
    {
        public string? LastSetSection { get; private set; }

        public double[]? LastPoints { get; private set; }

        public int GetSection(string Name, ref string PropName, ref string SAuto)
        {
            PropName = Name == "C1" ? "C500" : "B300";
            SAuto = string.Empty;
            return 0;
        }

        public int SetSection(string Name, string PropName)
        {
            LastSetSection = Name + "=" + PropName;
            return 0;
        }

        public int GetNameList(ref int NumberNames, ref string[] MyName)
        {
            MyName = new[] { "C1", "B1" };
            NumberNames = MyName.Length;
            return 0;
        }

        public int GetDesignOrientation(string Name, ref eOrientation DesignOrientation)
        {
            DesignOrientation = Name.StartsWith("C", StringComparison.Ordinal) ? eOrientation.Column : eOrientation.Beam;
            return 0;
        }

        public int CountByType(eOrientation Type) => Type == eOrientation.Column ? 7 : 3;

        public int GetThrows(string Name) => throw new InvalidOperationException("boom " + Name);

        public int SetPoints(string Name, double[] Coordinates)
        {
            LastPoints = Coordinates;
            return 0;
        }

        public int GetLoadDistributed(string Name, ref int NumberItems, ref string[] FrameName, ref string[] LoadPat, ref int[] MyType, ref string[] CSys, ref int[] Dir, ref double[] RD1, ref double[] RD2, ref double[] Dist1, ref double[] Dist2, ref double[] Val1, ref double[] Val2, eItemType ItemType = eItemType.Objects)
        {
            FrameName = new[] { "3" };
            LoadPat = new[] { "SDL" };
            MyType = new[] { 1 };
            CSys = new[] { "Global" };
            Dir = new[] { 10 };
            RD1 = new[] { 0.0 };
            RD2 = new[] { 1.0 };
            Dist1 = new[] { 0.0 };
            Dist2 = new[] { 6.0 };
            Val1 = new[] { 10.0 };
            Val2 = new[] { 10.0 };
            NumberItems = 1;
            return 0;
        }
    }
}
