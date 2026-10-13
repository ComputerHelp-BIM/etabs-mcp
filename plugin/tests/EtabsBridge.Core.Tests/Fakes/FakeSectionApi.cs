using System;

// Imitation of the CSI PropMaterial / PropFrame / PropArea objects (names, parameter
// names and ref/out shape as in the OAPI) for testing SectionService's late binding.
// Deliberately incomplete: some getters are missing or fail, to exercise warnings.
namespace EtabsBridge.Core.Tests.Fakes.FakeApi
{
    public enum eMatType
    {
        Steel = 1,
        Concrete = 2,
        NoDesign = 3,
        Aluminum = 4,
        ColdFormed = 5,
        Rebar = 6,
        Tendon = 7,
    }

    public enum eFramePropType
    {
        I = 1,
        Channel = 2,
        T = 3,
        Angle = 4,
        Box = 6,
        Pipe = 7,
        Rectangular = 8,
        Circle = 9,
        SD = 18,
    }

    public enum eSlabType
    {
        Slab = 0,
        Drop = 1,
        Ribbed = 3,
    }

    public enum eWallPropType
    {
        Specified = 1,
        AutoSelectList = 2,
    }

    public enum eShellType
    {
        ShellThin = 1,
        ShellThick = 2,
        Membrane = 3,
    }

    public interface IFakePropMaterial
    {
        int GetNameList(ref int NumberNames, ref string[] MyName, eMatType MatType = 0);

        int GetMaterial(string Name, ref eMatType MatType, ref int Color, ref string Notes, ref string GUID);

        int GetMPIsotropic(string Name, ref double E, ref double U, ref double A, double Temp = 0);

        int GetMPUniaxial(string Name, ref double E, ref double A, double Temp = 0);

        int GetWeightAndMass(string Name, ref double W, ref double M, double Temp = 0);

        int GetOConcrete_1(string Name, ref double Fc, ref bool IsLightweight, ref double FcsFactor, ref int SSType, ref int SSHysType, ref double StrainAtFc, ref double StrainUltimate, ref double FinalSlope, ref double FrictionAngle, ref double DilatationalAngle, double Temp = 0);

        int GetORebar_1(string Name, ref double Fy, ref double Fu, ref double EFy, ref double EFu, ref int SSType, ref int SSHysType, ref double StrainAtHardening, ref double StrainUltimate, ref double FinalSlope, ref bool UseCaltransSSDefaults, double Temp = 0);

        // GetOSteel_1 intentionally missing: the steel material must come back with Fy/Fu null and one warning.
    }

    public interface IFakePropFrame
    {
        int GetNameList(ref int NumberNames, ref string[] MyName);

        int GetTypeOAPI(string Name, ref eFramePropType PropType);

        int GetRectangle(string Name, ref string FileName, ref string MatProp, ref double T3, ref double T2, ref int Color, ref string Notes, ref string GUID);

        int GetCircle(string Name, ref string FileName, ref string MatProp, ref double T3, ref int Color, ref string Notes, ref string GUID);

        // Only the older GetISection exists here: the service must fall back from GetISection_1.
        int GetISection(string Name, ref string FileName, ref string MatProp, ref double T3, ref double T2, ref double Tf, ref double Tw, ref double T2b, ref double Tfb, ref int Color, ref string Notes, ref string GUID);

        int GetMaterial(string Name, ref string MatProp);

        int GetSectProps(string Name, ref double Area, ref double As2, ref double As3, ref double Torsion, ref double I22, ref double I33, ref double S22, ref double S33, ref double Z22, ref double Z33, ref double R22, ref double R33);
    }

    public interface IFakePropArea
    {
        int GetNameList(ref int NumberNames, ref string[] MyName);

        int GetSlab(string Name, ref eSlabType SlabType, ref eShellType ShellType, ref string MatProp, ref double Thickness, ref int color, ref string notes, ref string GUID);

        int GetWall(string Name, ref eWallPropType WallPropType, ref eShellType ShellType, ref string MatProp, ref double Thickness, ref int color, ref string notes, ref string GUID);
    }

    public sealed class FakePropMaterial : IFakePropMaterial
    {
        public int GetNameList(ref int NumberNames, ref string[] MyName, eMatType MatType = 0)
        {
            if (MatType != 0)
            {
                throw new InvalidOperationException("Filtered list requested; the service must ask for all (0).");
            }

            MyName = new[] { "C30", "A992Fy50", "HRB500" };
            NumberNames = MyName.Length;
            return 0;
        }

        public int GetMaterial(string Name, ref eMatType MatType, ref int Color, ref string Notes, ref string GUID)
        {
            MatType = Name == "C30" ? eMatType.Concrete : Name == "HRB500" ? eMatType.Rebar : eMatType.Steel;
            Color = 0x808080;
            return 0;
        }

        public int GetMPIsotropic(string Name, ref double E, ref double U, ref double A, double Temp = 0)
        {
            if (Name == "HRB500")
            {
                return 1; // rebar is uniaxial
            }

            E = Name == "C30" ? 30_000_000 : 200_000_000;
            U = Name == "C30" ? 0.2 : 0.3;
            A = Name == "C30" ? 1e-5 : 1.17e-5;
            return 0;
        }

        public int GetMPUniaxial(string Name, ref double E, ref double A, double Temp = 0)
        {
            E = 200_000_000;
            A = 1.17e-5;
            return 0;
        }

        public int GetWeightAndMass(string Name, ref double W, ref double M, double Temp = 0)
        {
            W = Name == "C30" ? 24.9926 : 76.9729;
            M = W / 9.80665;
            return 0;
        }

        public int GetOConcrete_1(string Name, ref double Fc, ref bool IsLightweight, ref double FcsFactor, ref int SSType, ref int SSHysType, ref double StrainAtFc, ref double StrainUltimate, ref double FinalSlope, ref double FrictionAngle, ref double DilatationalAngle, double Temp = 0)
        {
            Fc = 30_000;
            return 0;
        }

        public int GetORebar_1(string Name, ref double Fy, ref double Fu, ref double EFy, ref double EFu, ref int SSType, ref int SSHysType, ref double StrainAtHardening, ref double StrainUltimate, ref double FinalSlope, ref bool UseCaltransSSDefaults, double Temp = 0)
        {
            Fy = 500_000;
            Fu = 650_000;
            return 0;
        }
    }

    public sealed class FakePropFrame : IFakePropFrame
    {
        public int GetNameList(ref int NumberNames, ref string[] MyName)
        {
            MyName = new[] { "C500", "B300x600", "W12X26", "PILE600", "SD1" };
            NumberNames = MyName.Length;
            return 0;
        }

        public int GetTypeOAPI(string Name, ref eFramePropType PropType)
        {
            switch (Name)
            {
                case "W12X26": PropType = eFramePropType.I; break;
                case "PILE600": PropType = eFramePropType.Circle; break;
                case "SD1": PropType = eFramePropType.SD; break;
                default: PropType = eFramePropType.Rectangular; break;
            }

            return 0;
        }

        public int GetRectangle(string Name, ref string FileName, ref string MatProp, ref double T3, ref double T2, ref int Color, ref string Notes, ref string GUID)
        {
            MatProp = "C30";
            T3 = Name == "C500" ? 0.5 : 0.6;
            T2 = Name == "C500" ? 0.5 : 0.3;
            Color = 0x0000FF;
            return 0;
        }

        public int GetCircle(string Name, ref string FileName, ref string MatProp, ref double T3, ref int Color, ref string Notes, ref string GUID)
        {
            MatProp = "C30";
            T3 = 0.6;
            return 0;
        }

        public int GetISection(string Name, ref string FileName, ref string MatProp, ref double T3, ref double T2, ref double Tf, ref double Tw, ref double T2b, ref double Tfb, ref int Color, ref string Notes, ref string GUID)
        {
            MatProp = "A992Fy50";
            T3 = 0.3112;
            T2 = 0.1648;
            Tf = 0.0112;
            Tw = 0.0058;
            T2b = 0.1648;
            Tfb = 0.0112;
            return 0;
        }

        public int GetMaterial(string Name, ref string MatProp)
        {
            MatProp = "C30";
            return 0;
        }

        public int GetSectProps(string Name, ref double Area, ref double As2, ref double As3, ref double Torsion, ref double I22, ref double I33, ref double S22, ref double S33, ref double Z22, ref double Z33, ref double R22, ref double R33)
        {
            if (Name == "SD1")
            {
                return 1; // e.g. a section that ETABS cannot report properties for
            }

            Area = Name == "C500" ? 0.25 : 0.18;
            I33 = Name == "C500" ? 0.005208 : 0.0054;
            I22 = Name == "C500" ? 0.005208 : 0.00135;
            return 0;
        }
    }

    public sealed class FakePropArea : IFakePropArea
    {
        public int GetNameList(ref int NumberNames, ref string[] MyName)
        {
            MyName = new[] { "Slab200", "Wall250", "Mystery" };
            NumberNames = MyName.Length;
            return 0;
        }

        public int GetSlab(string Name, ref eSlabType SlabType, ref eShellType ShellType, ref string MatProp, ref double Thickness, ref int color, ref string notes, ref string GUID)
        {
            if (Name != "Slab200")
            {
                return 1;
            }

            SlabType = eSlabType.Slab;
            ShellType = eShellType.ShellThin;
            MatProp = "C30";
            Thickness = 0.2;
            color = 0x00FF00;
            return 0;
        }

        public int GetWall(string Name, ref eWallPropType WallPropType, ref eShellType ShellType, ref string MatProp, ref double Thickness, ref int color, ref string notes, ref string GUID)
        {
            if (Name != "Wall250")
            {
                return 1;
            }

            WallPropType = eWallPropType.Specified;
            ShellType = eShellType.ShellThin;
            MatProp = "C30";
            Thickness = 0.25;
            return 0;
        }
    }
}
