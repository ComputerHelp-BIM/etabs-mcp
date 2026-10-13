using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace ApiContractCheck
{
    /// <summary>
    /// Verifies the late-bound CSI API calls in C# sources against a real ETABSv1.dll (metadata only).
    ///
    /// 1. Every string literal shaped like an API path ("PropFrame.GetRectangle", "Results.Setup.X")
    ///    whose first segment is a property of cSapModel must resolve: each middle segment to a
    ///    property, the last to a method.
    /// 2. Every output name read with LateBoundApi helpers (Number/Text/Strings/Numbers/Color(r, "Key"))
    ///    must be a parameter name (case-insensitive, as ApiInvoker matches) of a method that the same
    ///    file calls. A file that calls no API path is checked against all resolved methods.
    ///
    /// Exit code 0 = all good, 1 = mismatches found, 2 = usage or load error.
    /// </summary>
    internal static class Program
    {
        private static readonly Regex ApiPath = new Regex("\"([A-Z][A-Za-z0-9_]*(?:\\.[A-Z][A-Za-z0-9_]*)+)\"", RegexOptions.Compiled);
        private static readonly Regex OutputHelper = new Regex("\\b(?:Number|Text|Strings|Numbers|Color)\\(", RegexOptions.Compiled);
        private static readonly Regex OutputKey = new Regex(",\\s*\"([A-Za-z_][A-Za-z0-9_]*)\"\\)", RegexOptions.Compiled);

        private static int Main(string[] args)
        {
            if (args.Length < 2)
            {
                Console.Error.WriteLine("usage: ApiContractCheck <path-to-ETABSv1.dll> <source-folder> [<source-folder> ...]");
                return 2;
            }

            string dll = Path.GetFullPath(args[0]);
            if (!File.Exists(dll))
            {
                Console.Error.WriteLine($"ETABSv1.dll not found: {dll}");
                return 2;
            }

            IEnumerable<string> resolverPaths = Directory.GetFiles(RuntimeEnvironment.GetRuntimeDirectory(), "*.dll").Append(dll);
            using var context = new MetadataLoadContext(new PathAssemblyResolver(resolverPaths));
            Type? sapModel = context.LoadFromAssemblyPath(dll).GetType("ETABSv1.cSapModel");
            if (sapModel == null)
            {
                Console.Error.WriteLine("ETABSv1.cSapModel not found in " + dll);
                return 2;
            }

            var errors = new List<string>();
            var allMethods = new List<MethodInfo>();
            var fileMethods = new Dictionary<string, List<MethodInfo>>();
            var fileKeys = new Dictionary<string, List<(string Key, int Line)>>();
            int pathCount = 0;

            foreach (string file in args.Skip(1).SelectMany(d => Directory.GetFiles(d, "*.cs", SearchOption.AllDirectories)).OrderBy(f => f, StringComparer.Ordinal))
            {
                string[] lines = File.ReadAllLines(file);
                var methods = new List<MethodInfo>();
                var keys = new List<(string, int)>();

                for (int i = 0; i < lines.Length; i++)
                {
                    string line = lines[i];
                    if (line.TrimStart().StartsWith("//", StringComparison.Ordinal))
                    {
                        continue;
                    }

                    foreach (Match m in ApiPath.Matches(line))
                    {
                        string path = m.Groups[1].Value;
                        string[] segments = path.Split('.');
                        if (sapModel.GetProperty(segments[0]) == null)
                        {
                            continue; // not a CSI API path (e.g. a type or file name)
                        }

                        pathCount++;
                        MethodInfo[] found = Resolve(sapModel, segments, out string? problem);
                        if (problem != null)
                        {
                            errors.Add($"{Rel(file)}:{i + 1}: \"{path}\": {problem}");
                        }

                        methods.AddRange(found);
                    }

                    if (OutputHelper.IsMatch(line))
                    {
                        foreach (Match k in OutputKey.Matches(line))
                        {
                            keys.Add((k.Groups[1].Value, i + 1));
                        }
                    }
                }

                fileMethods[file] = methods;
                fileKeys[file] = keys;
                allMethods.AddRange(methods);
            }

            int keyCount = 0;
            foreach (KeyValuePair<string, List<(string Key, int Line)>> entry in fileKeys)
            {
                List<MethodInfo> scope = fileMethods[entry.Key].Count > 0 ? fileMethods[entry.Key] : allMethods;
                var names = new HashSet<string>(scope.SelectMany(m => m.GetParameters()).Select(p => p.Name ?? string.Empty), StringComparer.OrdinalIgnoreCase);
                foreach ((string key, int line) in entry.Value)
                {
                    keyCount++;
                    if (!names.Contains(key))
                    {
                        errors.Add($"{Rel(entry.Key)}:{line}: output \"{key}\" is not a parameter of any API method this file calls");
                    }
                }
            }

            Console.WriteLine($"Checked {pathCount} API paths and {keyCount} output names against {dll}");
            if (errors.Count == 0)
            {
                Console.WriteLine("OK: every late-bound call matches the real ETABS API.");
                return 0;
            }

            foreach (string e in errors)
            {
                Console.WriteLine("::error::" + e);
            }

            Console.WriteLine($"{errors.Count} mismatch(es).");
            return 1;
        }

        /// <summary>Walks properties for the middle segments and returns the overloads of the final method.</summary>
        private static MethodInfo[] Resolve(Type root, string[] segments, out string? problem)
        {
            Type current = root;
            for (int i = 0; i < segments.Length - 1; i++)
            {
                PropertyInfo? property = AllMembers(current).OfType<PropertyInfo>().FirstOrDefault(p => p.Name == segments[i]);
                if (property == null)
                {
                    problem = $"no property '{segments[i]}' on {current.Name}";
                    return Array.Empty<MethodInfo>();
                }

                current = property.PropertyType;
            }

            string name = segments[^1];
            MethodInfo[] methods = AllMembers(current).OfType<MethodInfo>().Where(m => m.Name == name).ToArray();
            problem = methods.Length == 0 ? $"no method '{name}' on {current.Name}" : null;
            return methods;
        }

        /// <summary>Public members of a type and of every interface it implements (CSI objects are interfaces).</summary>
        private static IEnumerable<MemberInfo> AllMembers(Type type) =>
            type.GetMembers().Concat(type.GetInterfaces().SelectMany(i => i.GetMembers()));

        private static string Rel(string path) => Path.GetRelativePath(Directory.GetCurrentDirectory(), path).Replace('\\', '/');
    }
}
