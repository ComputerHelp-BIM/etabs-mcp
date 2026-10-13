using System;
using System.Collections.Generic;
using System.Globalization;
using EtabsBridge.Core.Ports;
using EtabsBridge.Core.Rpc;

namespace EtabsBridge.Core.Services
{
    /// <summary>
    /// Read-only, late-bound access to the CSI API for the "detail" readers (sections, loads, results).
    ///
    /// Methods are called by name through <see cref="ApiInvoker.InvokeWithInputs"/> and outputs are read by
    /// parameter name, so a getter whose name or signature differs in a given ETABS version becomes a
    /// warning and null values instead of a compile error or a failed request.
    /// Must run on the ETABS API thread.
    /// </summary>
    public sealed class LateBoundApi
    {
        private const int MaxWarnings = 50;

        private readonly ApiInvoker _api;
        private readonly List<string> _warnings = new List<string>();
        private readonly HashSet<string> _missingMethods = new HashSet<string>(StringComparer.Ordinal);

        public LateBoundApi(IEtabsModel model)
        {
            if (model == null)
            {
                throw new ArgumentNullException(nameof(model));
            }

            _api = new ApiInvoker(model.ApiRoot, model.ApiRootType, () => false); // read-only by construction
        }

        public IReadOnlyList<string> Warnings => _warnings;

        /// <summary>Calls a method; returns null (with a warning) when it is missing, throws, or returns non-zero.</summary>
        public ApiCallResult? Call(string method, params object?[] inputs) => Call(method, false, inputs);

        /// <summary>As <see cref="Call(string, object[])"/>; <paramref name="quiet"/> suppresses warnings for expected failures (probing).</summary>
        public ApiCallResult? Call(string method, bool quiet, params object?[] inputs)
        {
            try
            {
                ApiCallResult r = _api.InvokeWithInputs(method, inputs);
                if (r.ReturnValue is int rc && rc != 0)
                {
                    if (!quiet)
                    {
                        Warn($"{method}({Describe(inputs)}) returned {rc}.");
                    }

                    return null;
                }

                return r;
            }
            catch (BridgeException ex) when (ex.Status == 404 || ex.Status == 400)
            {
                if (!quiet && _missingMethods.Add(method))
                {
                    Warn($"{method} is not available in this ETABS version: {ex.Message}");
                }

                return null;
            }
            catch (EtabsApiException ex)
            {
                if (!quiet)
                {
                    Warn(ex.Message);
                }

                return null;
            }
        }

        /// <summary>Tries methods in order (newest first); returns the first success, warning once if none works.</summary>
        public ApiCallResult? FirstAvailable(IReadOnlyList<string> methods, string subject, params object?[] inputs)
        {
            foreach (string method in methods)
            {
                ApiCallResult? r = Call(method, true, inputs);
                if (r != null)
                {
                    return r;
                }
            }

            Warn($"No getter worked for {subject} (tried {string.Join(", ", methods)}).");
            return null;
        }

        /// <summary>The "MyName" output of a GetNameList-style method, or empty.</summary>
        public IReadOnlyList<string> NameList(string method)
        {
            ApiCallResult? r = Call(method);
            return r != null && r.Outputs.TryGetValue("MyName", out object? names) && names is string[] array ? array : Array.Empty<string>();
        }

        public void Warn(string message)
        {
            if (_warnings.Count < MaxWarnings)
            {
                _warnings.Add(message);
            }
            else if (_warnings.Count == MaxWarnings)
            {
                _warnings.Add("(more warnings omitted)");
            }
        }

        // ------------------------------------------------------------- output readers

        public static double? Number(ApiCallResult? r, string key)
        {
            if (r == null || !r.Outputs.TryGetValue(key, out object? v) || v == null)
            {
                return null;
            }

            switch (v)
            {
                case double d:
                    return double.IsNaN(d) || double.IsInfinity(d) ? (double?)null : d;
                case float f:
                    return f;
                case int i:
                    return i;
                case long l:
                    return l;
                default:
                    return null;
            }
        }

        public static string? Text(ApiCallResult? r, string key) =>
            r != null && r.Outputs.TryGetValue(key, out object? v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : null;

        public static string Color(ApiCallResult? r, string key) =>
            r != null && r.Outputs.TryGetValue(key, out object? v) && v is int color ? EtabsConventions.OleColorToHex(color) : "#808080";

        /// <summary>An array output as strings (enum members as names); empty when absent.</summary>
        public static string[] Strings(ApiCallResult? r, string key)
        {
            if (r == null || !r.Outputs.TryGetValue(key, out object? v) || !(v is Array a))
            {
                return Array.Empty<string>();
            }

            var result = new string[a.Length];
            for (int i = 0; i < a.Length; i++)
            {
                result[i] = Convert.ToString(a.GetValue(i), CultureInfo.InvariantCulture) ?? string.Empty;
            }

            return result;
        }

        /// <summary>A numeric array output as doubles (ints and enums converted); empty when absent.</summary>
        public static double[] Numbers(ApiCallResult? r, string key)
        {
            if (r == null || !r.Outputs.TryGetValue(key, out object? v) || !(v is Array a))
            {
                return Array.Empty<double>();
            }

            var result = new double[a.Length];
            for (int i = 0; i < a.Length; i++)
            {
                object? item = a.GetValue(i);
                result[i] = item == null ? 0 : Convert.ToDouble(item is Enum ? Convert.ToInt32(item, CultureInfo.InvariantCulture) : item, CultureInfo.InvariantCulture);
            }

            return result;
        }

        /// <summary>Number of records in parallel arrays: the smallest length, so ragged output can never index out of range.</summary>
        public static int Count(params Array[] arrays)
        {
            int n = int.MaxValue;
            foreach (Array a in arrays)
            {
                n = Math.Min(n, a.Length);
            }

            return n == int.MaxValue ? 0 : n;
        }

        private static string Describe(object?[] inputs) =>
            string.Join(", ", Array.ConvertAll(inputs, i => Convert.ToString(i, CultureInfo.InvariantCulture)));
    }
}
