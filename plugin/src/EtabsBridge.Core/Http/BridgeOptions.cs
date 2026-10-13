using System;
using System.Collections.Generic;

namespace EtabsBridge.Core.Http
{
    /// <summary>Runtime options for one bridge server.</summary>
    public sealed class BridgeOptions
    {
        /// <summary>First port tried. Each ETABS instance takes the next free port in the range.</summary>
        public int PreferredPort { get; set; } = 52780;

        /// <summary>Number of consecutive ports tried, starting at <see cref="PreferredPort"/>.</summary>
        public int PortRange { get; set; } = 20;

        /// <summary>Bearer token every request (except /health) must present.</summary>
        public string Token { get; set; } = string.Empty;

        /// <summary>
        /// Browser origins allowed to call the API (CORS), e.g. "http://localhost:5173" or
        /// "https://app.example.com". "*" allows any origin; the token is still required.
        /// Requests without an Origin header (DraftWin, MCP, curl) are not affected.
        /// </summary>
        public IReadOnlyList<string> AllowedOrigins { get; set; } = new[] { "http://localhost:5173", "http://127.0.0.1:5173" };

        /// <summary>Max time a request waits for ETABS (queue + execution) before 503 ETABS_BUSY.</summary>
        public TimeSpan CallTimeout { get; set; } = TimeSpan.FromSeconds(120);

        /// <summary>Maximum request body size in bytes.</summary>
        public int MaxBodyBytes { get; set; } = 1024 * 1024;

        /// <summary>Allows model-modifying RPC calls. Read per request, so it can be toggled while running.</summary>
        public Func<bool> WritesEnabled { get; set; } = () => false;
    }
}
