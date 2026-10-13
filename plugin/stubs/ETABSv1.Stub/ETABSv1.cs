// COMPILE-ONLY STUB of the ETABS API. See ETABSv1.Stub.csproj.
// Member names, parameter names and order mirror the CSI OAPI so that code compiled
// against this stub also compiles against the real ETABSv1.dll.
#pragma warning disable CS1591
#pragma warning disable IDE1006 // CSI naming style

namespace ETABSv1
{
    public enum eUnits
    {
        lb_in_F = 1,
        lb_ft_F = 2,
        kip_in_F = 3,
        kip_ft_F = 4,
        kN_mm_C = 5,
        kN_m_C = 6,
        kgf_mm_C = 7,
        kgf_m_C = 8,
        N_mm_C = 9,
        N_m_C = 10,
        Ton_mm_C = 11,
        Ton_m_C = 12,
        kN_cm_C = 13,
        kgf_cm_C = 14,
        N_cm_C = 15,
        Ton_cm_C = 16,
    }

    public enum eFrameDesignOrientation
    {
        Column = 1,
        Beam = 2,
        Brace = 3,
        Null = 4,
        Other = 5,
    }

    public enum eAreaDesignOrientation
    {
        Wall = 1,
        Floor = 2,
        Ramp_DO_NOT_USE = 3,
        Null = 4,
        Other = 5,
    }

    public interface cPluginCallback
    {
        void Finish(int iVal);
    }

    public interface cPluginContract
    {
        int Info(ref string Text);

        void Main(ref cSapModel SapModel, ref cPluginCallback ISapPlugin);
    }

    public interface cOAPI
    {
        cSapModel SapModel { get; }
    }

    public interface cHelper
    {
        cOAPI GetObject(string typeName);

        cOAPI GetObjectProcess(string typeName, int pid);
    }

    public class Helper : cHelper
    {
        public cOAPI GetObject(string typeName) => throw new System.NotSupportedException("ETABSv1 stub");

        public cOAPI GetObjectProcess(string typeName, int pid) => throw new System.NotSupportedException("ETABSv1 stub");
    }

    public interface cSapModel
    {
        cStory Story { get; }

        cGridSys GridSys { get; }

        cPointObj PointObj { get; }

        cFrameObj FrameObj { get; }

        cAreaObj AreaObj { get; }

        cDatabaseTables DatabaseTables { get; }

        string GetModelFilename(bool IncludePath = true);

        eUnits GetPresentUnits();

        int GetVersion(ref string Version, ref double MyVersionNumber);

        bool GetModelIsLocked();
    }

    public interface cStory
    {
        int GetStories_2(
            ref double BaseElevation,
            ref int NumberStories,
            ref string[] StoryNames,
            ref double[] StoryElevations,
            ref double[] StoryHeights,
            ref bool[] IsMasterStory,
            ref string[] SimilarToStory,
            ref bool[] SpliceAbove,
            ref double[] SpliceHeight,
            ref int[] color);
    }

    public interface cGridSys
    {
        int GetNameList(ref int NumberNames, ref string[] MyName);

        int GetGridSys_2(
            string Name,
            ref double Xo,
            ref double Yo,
            ref double RZ,
            ref string GridSysType,
            ref int NumXLines,
            ref int NumYLines,
            ref string[] GridLineIDX,
            ref string[] GridLineIDY,
            ref double[] OrdinateX,
            ref double[] OrdinateY,
            ref bool[] VisibleX,
            ref bool[] VisibleY,
            ref string[] BubbleLocX,
            ref string[] BubbleLocY);
    }

    public interface cPointObj
    {
        int GetAllPoints(ref int NumberNames, ref string[] MyName, ref double[] X, ref double[] Y, ref double[] Z, string CSys = "Global");

        int GetLabelFromName(string Name, ref string Label, ref string Story);

        int GetRestraint(string Name, ref bool[] Value);
    }

    public interface cFrameObj
    {
        int GetAllFrames(
            ref int NumberNames,
            ref string[] MyName,
            ref string[] PropName,
            ref string[] StoryName,
            ref string[] PointName1,
            ref string[] PointName2,
            ref double[] Point1X,
            ref double[] Point1Y,
            ref double[] Point1Z,
            ref double[] Point2X,
            ref double[] Point2Y,
            ref double[] Point2Z,
            ref double[] Angle,
            ref double[] Offset1X,
            ref double[] Offset2X,
            ref double[] Offset1Y,
            ref double[] Offset2Y,
            ref double[] Offset1Z,
            ref double[] Offset2Z,
            ref int[] CardinalPoint,
            string csys = "Global");

        int GetDesignOrientation(string Name, ref eFrameDesignOrientation DesignOrientation);

        int GetLabelFromName(string Name, ref string Label, ref string Story);

        int GetSection(string Name, ref string PropName, ref string SAuto);
    }

    public interface cAreaObj
    {
        int GetNameList(ref int NumberNames, ref string[] MyName);

        int GetPoints(string Name, ref int NumberPoints, ref string[] Point);

        int GetProperty(string Name, ref string PropName);

        int GetDesignOrientation(string Name, ref eAreaDesignOrientation DesignOrientation);

        int GetLabelFromName(string Name, ref string Label, ref string Story);
    }

    public interface cDatabaseTables
    {
        int GetAllTables(ref int NumberTables, ref string[] TableKey, ref string[] TableName, ref int[] ImportType, ref bool[] IsEmpty);

        int GetTableForDisplayArray(
            string TableKey,
            ref string[] FieldKeyList,
            string GroupName,
            ref int TableVersion,
            ref string[] FieldsKeysIncluded,
            ref int NumberRecords,
            ref string[] TableData);
    }
}
