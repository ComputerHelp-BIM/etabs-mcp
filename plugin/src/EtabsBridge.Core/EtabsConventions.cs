using System;
using System.Globalization;
using EtabsBridge.Core.Model;

namespace EtabsBridge.Core
{
    /// <summary>
    /// Translations from ETABS API conventions to the bridge contract. Kept here (not in
    /// the adapter) so they are unit-tested without ETABS.
    /// </summary>
    public static class EtabsConventions
    {
        /// <summary>
        /// Parses an ETABS eUnits name ("kN_m_C", "kip_ft_F", "Ton_mm_C", ...) into its parts.
        /// Unknown formats keep the name and leave the parts empty rather than failing.
        /// </summary>
        public static UnitsInfo ParseUnits(string unitsName)
        {
            var info = new UnitsInfo { Name = unitsName ?? string.Empty };
            string[] parts = info.Name.Split('_');
            if (parts.Length == 3)
            {
                info.Force = parts[0];
                info.Length = parts[1];
                info.Temperature = parts[2];
            }

            return info;
        }

        /// <summary>
        /// Normalizes a frame design orientation (eFrameDesignOrientation name) to
        /// "Column", "Beam", "Brace", "Null" or "Other".
        /// </summary>
        public static string NormalizeFrameType(string orientation) =>
            NormalizeEnumName(orientation, "Column", "Beam", "Brace", "Null");

        /// <summary>
        /// Normalizes an area design orientation (eAreaDesignOrientation name) to
        /// "Wall", "Floor", "Ramp", "Null" or "Other". ETABS names the ramp member
        /// "Ramp_DO_NOT_USE"; it is reported as "Ramp".
        /// </summary>
        public static string NormalizeAreaType(string orientation) =>
            NormalizeEnumName(orientation, "Wall", "Floor", "Ramp", "Null");

        /// <summary>
        /// Converts an ETABS (OLE/Win32) color integer 0x00BBGGRR to "#rrggbb".
        /// </summary>
        public static string OleColorToHex(int oleColor)
        {
            int r = oleColor & 0xFF;
            int g = (oleColor >> 8) & 0xFF;
            int b = (oleColor >> 16) & 0xFF;
            return string.Format(CultureInfo.InvariantCulture, "#{0:x2}{1:x2}{2:x2}", r, g, b);
        }

        /// <summary>Returns null for null/empty/whitespace and "None" (ETABS's "no value" marker).</summary>
        public static string? EmptyToNull(string? value) =>
            string.IsNullOrWhiteSpace(value) || string.Equals(value, "None", StringComparison.OrdinalIgnoreCase)
                ? null
                : value;

        private static string NormalizeEnumName(string orientation, params string[] known)
        {
            if (!string.IsNullOrEmpty(orientation))
            {
                foreach (string k in known)
                {
                    if (orientation.StartsWith(k, StringComparison.OrdinalIgnoreCase))
                    {
                        return k;
                    }
                }
            }

            return "Other";
        }
    }
}
