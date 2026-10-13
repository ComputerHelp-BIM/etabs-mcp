using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using EtabsBridge.Core.Json;

namespace EtabsBridge.Core.Configuration
{
    /// <summary>
    /// User-editable plugin settings, stored as JSON in %APPDATA%\EtabsBridge\settings.json.
    /// The file is created with defaults on first run.
    /// </summary>
    public sealed class BridgeSettings
    {
        /// <summary>The hosted sample web app (Vercel production deployment of the dev branch).</summary>
        public const string HostedWebAppUrl = "https://etabs-bridge.vercel.app/";

        /// <summary>
        /// Default CORS allow-list: the hosted web app, its Vercel preview deployments (only the
        /// "computer-help" team can create hosts with that suffix) and the local dev server.
        /// </summary>
        public static IReadOnlyList<string> DefaultAllowedOrigins { get; } = new[]
        {
            "https://etabs-bridge.vercel.app",
            "https://etabs-bridge-*-computer-help.vercel.app",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        };

        public int PreferredPort { get; set; } = 52780;

        /// <summary>Browser origins allowed to call the bridge. Add your web app's origin here.</summary>
        public IReadOnlyList<string> AllowedOrigins { get; set; } = DefaultAllowedOrigins;

        /// <summary>Opened by the "Open web app" button, with the connection in the URL fragment.</summary>
        public string WebAppUrl { get; set; } = HostedWebAppUrl;

        public int CallTimeoutSeconds { get; set; } = 120;

        public static string DefaultPath() => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "EtabsBridge",
            "settings.json");

        /// <summary>
        /// Loads settings. A missing file is created with defaults. Invalid content falls back to
        /// defaults for the bad values and reports why in <paramref name="warning"/> (never throws for content).
        /// </summary>
        public static BridgeSettings Load(string path, out string? warning)
        {
            warning = null;
            var settings = new BridgeSettings();
            if (!File.Exists(path))
            {
                try
                {
                    settings.Save(path);
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    warning = $"Could not create {path}: {ex.Message}";
                }

                return settings;
            }

            JsonValue json;
            try
            {
                json = JsonParser.Parse(File.ReadAllText(path, Encoding.UTF8));
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is FormatException)
            {
                warning = $"Ignoring {path} (using defaults): {ex.Message}";
                return settings;
            }

            var problems = new List<string>();

            long? port = SafeInt(json, "preferredPort", problems);
            if (port.HasValue)
            {
                if (port.Value >= 1024 && port.Value <= 65000)
                {
                    settings.PreferredPort = (int)port.Value;
                }
                else
                {
                    problems.Add("preferredPort must be 1024..65000");
                }
            }

            JsonValue? origins = json.Get("allowedOrigins");
            if (origins != null)
            {
                if (origins.Kind == JsonKind.Array && origins.AsArray().All(o => o.Kind == JsonKind.String))
                {
                    settings.AllowedOrigins = origins.AsArray().Select(o => o.AsString().Trim().TrimEnd('/')).Where(o => o.Length > 0).ToList();
                }
                else
                {
                    problems.Add("allowedOrigins must be an array of strings");
                }
            }

            string? webAppUrl = json.GetString("webAppUrl");
            if (webAppUrl != null)
            {
                if (Uri.TryCreate(webAppUrl, UriKind.Absolute, out Uri? uri) && (uri.Scheme == "http" || uri.Scheme == "https"))
                {
                    settings.WebAppUrl = webAppUrl;
                }
                else
                {
                    problems.Add("webAppUrl must be an absolute http(s) URL");
                }
            }

            long? timeout = SafeInt(json, "callTimeoutSeconds", problems);
            if (timeout.HasValue)
            {
                if (timeout.Value >= 5 && timeout.Value <= 3600)
                {
                    settings.CallTimeoutSeconds = (int)timeout.Value;
                }
                else
                {
                    problems.Add("callTimeoutSeconds must be 5..3600");
                }
            }

            if (problems.Count > 0)
            {
                warning = $"Settings {path}: " + string.Join("; ", problems) + " (defaults used for these).";
            }

            return settings;
        }

        public void Save(string path)
        {
            string? dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }

            File.WriteAllText(path, JsonSerializer.Serialize(this), new UTF8Encoding(false));
        }

        private static long? SafeInt(JsonValue json, string key, List<string> problems)
        {
            JsonValue? v = json.Get(key);
            if (v == null)
            {
                return null;
            }

            try
            {
                return v.AsInt64();
            }
            catch (Exception ex) when (ex is FormatException || ex is InvalidOperationException)
            {
                problems.Add($"{key} must be an integer");
                return null;
            }
        }
    }

    /// <summary>Session secrets and connection links.</summary>
    public static class BridgeSecurity
    {
        /// <summary>New random 256-bit token, base64url (43 chars).</summary>
        public static string CreateToken()
        {
            byte[] bytes = new byte[32];
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(bytes);
            }

            return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        /// <summary>
        /// Builds "{webAppUrl}#bridgeUrl=...&amp;token=...". The fragment is never sent to the
        /// web server hosting the app, so the token stays on this machine.
        /// </summary>
        public static string BuildWebAppLink(string webAppUrl, string bridgeUrl, string token)
        {
            string baseUrl = webAppUrl;
            int hash = baseUrl.IndexOf('#');
            if (hash >= 0)
            {
                baseUrl = baseUrl.Substring(0, hash);
            }

            return baseUrl + "#bridgeUrl=" + Uri.EscapeDataString(bridgeUrl) + "&token=" + Uri.EscapeDataString(token);
        }
    }
}
