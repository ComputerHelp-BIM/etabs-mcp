using System;
using System.Collections.Generic;

namespace EtabsBridge.Core.Http
{
    /// <summary>Transport-independent HTTP request, so routing is testable without sockets.</summary>
    public sealed class BridgeRequest
    {
        public BridgeRequest(string method, string path)
        {
            Method = (method ?? "GET").ToUpperInvariant();
            Path = path ?? "/";
        }

        public string Method { get; }

        /// <summary>URL path without query string, e.g. "/api/v1/geometry".</summary>
        public string Path { get; }

        /// <summary>Decoded query parameters (last value wins).</summary>
        public IDictionary<string, string> Query { get; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        /// <summary>Request headers, case-insensitive.</summary>
        public IDictionary<string, string> Headers { get; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public string Body { get; set; } = string.Empty;

        public string? Header(string name) => Headers.TryGetValue(name, out string? v) ? v : null;

        public string? QueryValue(string name) => Query.TryGetValue(name, out string? v) ? v : null;
    }

    public sealed class BridgeResponse
    {
        public int Status { get; set; } = 200;

        public IDictionary<string, string> Headers { get; } = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        /// <summary>JSON body, or null for no body (e.g. 204).</summary>
        public string? Body { get; set; }
    }

    /// <summary>Raised after every request; the plugin window shows these as a log.</summary>
    public sealed class RequestLogEntry
    {
        public DateTime Timestamp { get; set; }

        public string Method { get; set; } = string.Empty;

        public string Path { get; set; } = string.Empty;

        public int Status { get; set; }

        public long DurationMs { get; set; }

        /// <summary>Error message for failed requests.</summary>
        public string? Error { get; set; }
    }
}
