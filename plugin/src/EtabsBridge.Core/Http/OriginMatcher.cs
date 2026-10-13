using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace EtabsBridge.Core.Http
{
    /// <summary>
    /// Matches a browser Origin ("https://app.example.com") against the allowedOrigins setting.
    ///
    /// Supported entries:
    /// <list type="bullet">
    /// <item>"*": any origin (the token is still required).</item>
    /// <item>Exact origin: "https://app.example.com" (case-insensitive, trailing slash ignored).</item>
    /// <item>Host wildcard: "https://*.vercel.app" or "https://etabs-viewer-*.vercel.app". Each "*" matches
    /// one or more letters, digits or hyphens, and never a dot, so it stays within one DNS label.
    /// The scheme and port must match exactly.</item>
    /// </list>
    /// </summary>
    public sealed class OriginMatcher
    {
        private readonly bool _any;
        private readonly HashSet<string> _exact = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        private readonly List<Regex> _patterns = new List<Regex>();

        public OriginMatcher(IEnumerable<string> allowedOrigins)
        {
            foreach (string raw in allowedOrigins ?? Enumerable.Empty<string>())
            {
                string entry = (raw ?? string.Empty).Trim().TrimEnd('/');
                if (entry.Length == 0)
                {
                    continue;
                }

                if (entry == "*")
                {
                    _any = true;
                }
                else if (entry.IndexOf('*') >= 0)
                {
                    string pattern = "^" + Regex.Escape(entry).Replace("\\*", "[a-z0-9-]+") + "$";
                    _patterns.Add(new Regex(pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100)));
                }
                else
                {
                    _exact.Add(entry);
                }
            }
        }

        public bool IsAllowed(string? origin)
        {
            if (string.IsNullOrEmpty(origin))
            {
                return false;
            }

            if (_any)
            {
                return true;
            }

            string o = origin!.TrimEnd('/');
            return _exact.Contains(o) || _patterns.Any(p => p.IsMatch(o));
        }
    }
}
