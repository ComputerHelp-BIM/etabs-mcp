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
    }

    public sealed class FakeSapModel : IFakeSapModel
    {
        public FakeFrameObj Frames { get; } = new FakeFrameObj();

        public IFakeFrameObj FrameObj => Frames;

        public IFakeNullObj Broken => null!;

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
    }
}
