using System.Reflection;

namespace EtabsBridge.Core
{
    /// <summary>Static facts about this build of the bridge.</summary>
    public static class BridgeInfo
    {
        /// <summary>REST API major version; part of every route (/api/v1/...).</summary>
        public const string ApiVersion = "1";

        /// <summary>Route prefix for all endpoints.</summary>
        public const string ApiPrefix = "/api/v" + ApiVersion;

        /// <summary>Semantic version of the bridge (MAJOR.MINOR.PATCH), from Directory.Build.props.</summary>
        public static string Version { get; } = ReadVersion();

        private static string ReadVersion()
        {
            Assembly asm = typeof(BridgeInfo).Assembly;
            string? informational = asm.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
            if (!string.IsNullOrEmpty(informational))
            {
                // Strip SourceLink "+commitsha" metadata: "0.1.0+abc123" -> "0.1.0".
                int plus = informational!.IndexOf('+');
                return plus >= 0 ? informational.Substring(0, plus) : informational;
            }

            return asm.GetName().Version?.ToString(3) ?? "0.0.0";
        }
    }
}
