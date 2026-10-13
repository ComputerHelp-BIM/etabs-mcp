using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using EtabsBridge.Core.Json;

namespace EtabsBridge.Core.Discovery
{
    /// <summary>One running bridge, as written to the registry folder.</summary>
    public sealed class InstanceRecord
    {
        public int ProcessId { get; set; }

        public int Port { get; set; }

        public string BaseUrl { get; set; } = string.Empty;

        public string Token { get; set; } = string.Empty;

        /// <summary>Full model path; empty for an unsaved model.</summary>
        public string ModelPath { get; set; } = string.Empty;

        public string EtabsVersion { get; set; } = string.Empty;

        public string BridgeVersion { get; set; } = string.Empty;

        /// <summary>UTC start time, ISO 8601.</summary>
        public string StartedAt { get; set; } = string.Empty;
    }

    /// <summary>
    /// File-based discovery of running bridges: one JSON file per ETABS process in
    /// %LOCALAPPDATA%\EtabsBridge\instances\{pid}.json.
    ///
    /// Local clients (DraftWin, the MCP server) list this folder to find every open
    /// ETABS model and its URL + token, which solves "which instance?" without any
    /// COM attach. The folder lives in the user profile, so only the same Windows user
    /// can read the tokens. Override the folder with ETABS_BRIDGE_REGISTRY_DIR.
    /// </summary>
    public sealed class InstanceRegistry
    {
        public const string DirectoryEnvironmentVariable = "ETABS_BRIDGE_REGISTRY_DIR";

        public InstanceRegistry(string? directory = null)
        {
            Directory = directory ?? DefaultDirectory();
        }

        public string Directory { get; }

        public static string DefaultDirectory()
        {
            string? fromEnv = Environment.GetEnvironmentVariable(DirectoryEnvironmentVariable);
            if (!string.IsNullOrWhiteSpace(fromEnv))
            {
                return fromEnv!;
            }

            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "EtabsBridge",
                "instances");
        }

        /// <summary>Writes (or replaces) the record for its process, atomically.</summary>
        public void Register(InstanceRecord record)
        {
            if (record == null)
            {
                throw new ArgumentNullException(nameof(record));
            }

            System.IO.Directory.CreateDirectory(Directory);
            string target = PathFor(record.ProcessId);
            string temp = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temp, JsonSerializer.Serialize(record), new UTF8Encoding(false));
            if (File.Exists(target))
            {
                File.Replace(temp, target, null);
            }
            else
            {
                File.Move(temp, target);
            }
        }

        public void Unregister(int processId)
        {
            try
            {
                File.Delete(PathFor(processId));
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }

        /// <summary>
        /// Lists live instances, deleting records whose process has exited (e.g. ETABS crashed).
        /// Unreadable files are skipped.
        /// </summary>
        public IReadOnlyList<InstanceRecord> List(Func<int, bool>? isProcessAlive = null)
        {
            isProcessAlive ??= IsProcessAlive;
            if (!System.IO.Directory.Exists(Directory))
            {
                return Array.Empty<InstanceRecord>();
            }

            var result = new List<InstanceRecord>();
            foreach (string file in System.IO.Directory.GetFiles(Directory, "*.json"))
            {
                InstanceRecord? record = TryRead(file);
                if (record == null)
                {
                    continue;
                }

                if (!isProcessAlive(record.ProcessId))
                {
                    Unregister(record.ProcessId);
                    continue;
                }

                result.Add(record);
            }

            return result.OrderBy(r => r.ProcessId).ToList();
        }

        private string PathFor(int processId) => Path.Combine(Directory, processId.ToString(System.Globalization.CultureInfo.InvariantCulture) + ".json");

        private static InstanceRecord? TryRead(string file)
        {
            try
            {
                JsonValue json = JsonParser.Parse(File.ReadAllText(file, Encoding.UTF8));
                return new InstanceRecord
                {
                    ProcessId = (int)(json.GetInt64("processId") ?? 0),
                    Port = (int)(json.GetInt64("port") ?? 0),
                    BaseUrl = json.GetString("baseUrl") ?? string.Empty,
                    Token = json.GetString("token") ?? string.Empty,
                    ModelPath = json.GetString("modelPath") ?? string.Empty,
                    EtabsVersion = json.GetString("etabsVersion") ?? string.Empty,
                    BridgeVersion = json.GetString("bridgeVersion") ?? string.Empty,
                    StartedAt = json.GetString("startedAt") ?? string.Empty,
                };
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException || ex is FormatException || ex is InvalidOperationException)
            {
                return null;
            }
        }

        private static bool IsProcessAlive(int processId)
        {
            if (processId <= 0)
            {
                return false;
            }

            try
            {
                using (Process p = Process.GetProcessById(processId))
                {
                    return !p.HasExited;
                }
            }
            catch (ArgumentException)
            {
                return false; // no such process
            }
            catch (InvalidOperationException)
            {
                return false;
            }
        }
    }
}
