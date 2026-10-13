using System;

// Imitation of CSI LoadPatterns / LoadCases / RespCombo and the load getters of FrameObj,
// AreaObj and PointObj, for LoadsService tests.
namespace EtabsBridge.Core.Tests.Fakes.FakeApi
{
    public enum eLoadPatternType
    {
        Dead = 1,
        SuperDead = 2,
        Live = 3,
        Quake = 5,
    }

    public enum eLoadCaseType
    {
        LinearStatic = 1,
        Modal = 3,
        ResponseSpectrum = 4,
    }

    public enum eCNameType
    {
        LoadCase = 0,
        LoadCombo = 1,
    }

    public enum eItemType
    {
        Objects = 0,
        Group = 1,
        SelectedObjects = 2,
    }

    public interface IFakeLoadPatterns
    {
        int GetNameList(ref int NumberNames, ref string[] MyName);

        int GetLoadType(string Name, ref eLoadPatternType MyType);

        int GetSelfWTMultiplier(string Name, ref double SelfWTMultiplier);
    }

    public interface IFakeLoadCases
    {
        int GetNameList(ref int NumberNames, ref string[] MyName);

        // Only the older getter exists: the service must fall back from GetTypeOAPI_1.
        int GetTypeOAPI(string Name, ref eLoadCaseType CaseType, ref int SubType);
    }

    public interface IFakeRespCombo
    {
        int GetNameList(ref int NumberNames, ref string[] MyName);

        int GetTypeOAPI(string Name, ref int ComboType);

        int GetCaseList(string Name, ref int NumberItems, ref eCNameType[] CNameType, ref string[] CName, ref double[] SF);
    }

    public interface IFakeAreaObj
    {
        int GetLoadUniform(string Name, ref int NumberItems, ref string[] AreaName, ref string[] LoadPat, ref string[] CSys, ref int[] Dir, ref double[] Value, eItemType ItemType = eItemType.Objects);
    }

    public interface IFakePointObj
    {
        int GetLoadForce(string Name, ref int NumberItems, ref string[] PointName, ref string[] LoadPat, ref int[] LCStep, ref string[] CSys, ref double[] F1, ref double[] F2, ref double[] F3, ref double[] M1, ref double[] M2, ref double[] M3, eItemType ItemType = eItemType.Objects);
    }

    public sealed class FakeLoadPatterns : IFakeLoadPatterns
    {
        public int GetNameList(ref int NumberNames, ref string[] MyName)
        {
            MyName = new[] { "Dead", "SDL", "Live", "EQX" };
            NumberNames = MyName.Length;
            return 0;
        }

        public int GetLoadType(string Name, ref eLoadPatternType MyType)
        {
            MyType = Name switch { "Dead" => eLoadPatternType.Dead, "SDL" => eLoadPatternType.SuperDead, "Live" => eLoadPatternType.Live, _ => eLoadPatternType.Quake };
            return 0;
        }

        public int GetSelfWTMultiplier(string Name, ref double SelfWTMultiplier)
        {
            SelfWTMultiplier = Name == "Dead" ? 1 : 0;
            return 0;
        }
    }

    public sealed class FakeLoadCases : IFakeLoadCases
    {
        public int GetNameList(ref int NumberNames, ref string[] MyName)
        {
            MyName = new[] { "Dead", "Modal" };
            NumberNames = MyName.Length;
            return 0;
        }

        public int GetTypeOAPI(string Name, ref eLoadCaseType CaseType, ref int SubType)
        {
            CaseType = Name == "Modal" ? eLoadCaseType.Modal : eLoadCaseType.LinearStatic;
            SubType = Name == "Modal" ? 1 : 0;
            return 0;
        }
    }

    public sealed class FakeRespCombo : IFakeRespCombo
    {
        public int GetNameList(ref int NumberNames, ref string[] MyName)
        {
            MyName = new[] { "ULS1", "ENV" };
            NumberNames = MyName.Length;
            return 0;
        }

        public int GetTypeOAPI(string Name, ref int ComboType)
        {
            ComboType = Name == "ENV" ? 1 : 0;
            return 0;
        }

        public int GetCaseList(string Name, ref int NumberItems, ref eCNameType[] CNameType, ref string[] CName, ref double[] SF)
        {
            if (Name == "ENV")
            {
                CNameType = new[] { eCNameType.LoadCombo };
                CName = new[] { "ULS1" };
                SF = new[] { 1.0 };
            }
            else
            {
                CNameType = new[] { eCNameType.LoadCase, eCNameType.LoadCase };
                CName = new[] { "Dead", "Live" };
                SF = new[] { 1.5, 1.5 };
            }

            NumberItems = CName.Length;
            return 0;
        }
    }

    public sealed class FakeAreaObj : IFakeAreaObj
    {
        public int GetLoadUniform(string Name, ref int NumberItems, ref string[] AreaName, ref string[] LoadPat, ref string[] CSys, ref int[] Dir, ref double[] Value, eItemType ItemType = eItemType.Objects)
        {
            if (Name != "All" || ItemType != eItemType.Group)
            {
                throw new InvalidOperationException("Expected Name=All, ItemType=Group");
            }

            AreaName = new[] { "1", "1" };
            LoadPat = new[] { "SDL", "Live" };
            CSys = new[] { "Global", "Global" };
            Dir = new[] { 10, 10 };
            Value = new[] { 1.5, 3.0 };
            NumberItems = 2;
            return 0;
        }
    }

    public sealed class FakePointObj : IFakePointObj
    {
        public int GetLoadForce(string Name, ref int NumberItems, ref string[] PointName, ref string[] LoadPat, ref int[] LCStep, ref string[] CSys, ref double[] F1, ref double[] F2, ref double[] F3, ref double[] M1, ref double[] M2, ref double[] M3, eItemType ItemType = eItemType.Objects)
        {
            PointName = new[] { "9" };
            LoadPat = new[] { "EQX" };
            LCStep = new[] { 0 };
            CSys = new[] { "Global" };
            F1 = new[] { 120.0 };
            F2 = new[] { 0.0 };
            F3 = new[] { 0.0 };
            M1 = new[] { 0.0 };
            M2 = new[] { 0.0 };
            M3 = new[] { 0.0 };
            NumberItems = 1;
            return 0;
        }
    }
}
