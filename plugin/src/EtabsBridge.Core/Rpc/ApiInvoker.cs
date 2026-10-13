using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using EtabsBridge.Core.Json;

namespace EtabsBridge.Core.Rpc
{
    /// <summary>Result of a reflective API call.</summary>
    public sealed class ApiCallResult
    {
        /// <summary>Normalized method path, e.g. "FrameObj.GetSection".</summary>
        public string Method { get; set; } = string.Empty;

        /// <summary>The method's return value (ETABS: usually 0 = success), or null for void.</summary>
        public object? ReturnValue { get; set; }

        /// <summary>Final values of all ref/out parameters, keyed by parameter name.</summary>
        public IDictionary<string, object?> Outputs { get; set; } = new Dictionary<string, object?>();
    }

    /// <summary>
    /// Calls any method of the ETABS API object model by path, e.g. "FrameObj.GetSection",
    /// with JSON arguments. This is the bridge's "no restrictions" escape hatch: anything
    /// the CSI OAPI can do is reachable without a dedicated endpoint.
    ///
    /// Reflection walks the declared interface types (cSapModel, cFrameObj, ...), not
    /// runtime types, so it behaves the same for in-process objects (plugin) and COM
    /// proxies (external attach).
    ///
    /// Write protection: methods are classified by <see cref="RpcPolicy"/>; non read-only
    /// calls are refused unless writes are enabled by the host (plugin window checkbox).
    /// </summary>
    public sealed class ApiInvoker
    {
        private readonly object _root;
        private readonly Type _rootType;
        private readonly Func<bool> _writesEnabled;

        /// <param name="root">API root object (cSapModel instance).</param>
        /// <param name="rootType">Interface type to reflect over (typeof(cSapModel)).</param>
        /// <param name="writesEnabled">Evaluated per call; true allows non read-only methods.</param>
        public ApiInvoker(object root, Type rootType, Func<bool> writesEnabled)
        {
            _root = root ?? throw new ArgumentNullException(nameof(root));
            _rootType = rootType ?? throw new ArgumentNullException(nameof(rootType));
            _writesEnabled = writesEnabled ?? throw new ArgumentNullException(nameof(writesEnabled));
        }

        /// <summary>Describes the object at <paramref name="path"/> ("" or "SapModel" for the root).</summary>
        public ApiTypeDescription Describe(string? path)
        {
            (object _, Type type, string normalized) = ResolveObject(SplitPath(path));
            return ApiTypeDescription.Create(normalized, type);
        }

        /// <summary>
        /// Invokes <paramref name="methodPath"/> with <paramref name="args"/>: a JSON object
        /// (arguments by parameter name, case-insensitive), a JSON array (positional), or null.
        /// Omitted ref/out parameters are initialized to empty values; omitted optional
        /// parameters take their declared default.
        /// </summary>
        public ApiCallResult Invoke(string methodPath, JsonValue? args)
        {
            int supplied = args == null || args.IsNull ? 0
                : args.Kind == JsonKind.Array ? args.AsArray().Count
                : args.Kind == JsonKind.Object ? args.AsObject().Count
                : -1;
            (object target, MethodInfo method, string fullName) = Resolve(methodPath, supplied);
            object?[] values = BindArguments(method.GetParameters(), args, fullName);
            return Execute(target, method, fullName, values);
        }

        /// <summary>
        /// Late-bound call for internal readers (e.g. sections/materials): <paramref name="inputs"/> fill the
        /// method's non-ref parameters in order (CLR values, converted where needed); every ref/out parameter
        /// starts empty and is returned in <see cref="ApiCallResult.Outputs"/> (keys case-insensitive).
        /// Binding by name at runtime means an API signature that differs between ETABS versions surfaces
        /// as a catchable error instead of a compile/load failure.
        /// </summary>
        /// <exception cref="BridgeException">404 when the method does not exist; 400 when inputs do not fit.</exception>
        /// <exception cref="EtabsApiException">The API threw.</exception>
        public ApiCallResult InvokeWithInputs(string methodPath, params object?[] inputs)
        {
            inputs ??= Array.Empty<object?>();
            (object target, MethodInfo method, string fullName) = Resolve(methodPath, inputs.Length);
            ParameterInfo[] parameters = method.GetParameters();
            var values = new object?[parameters.Length];
            int next = 0;
            for (int i = 0; i < parameters.Length; i++)
            {
                ParameterInfo p = parameters[i];
                Type type = p.ParameterType.IsByRef ? p.ParameterType.GetElementType()! : p.ParameterType;
                if (p.ParameterType.IsByRef)
                {
                    values[i] = JsonArgumentConverter.EmptyValue(type);
                }
                else if (next < inputs.Length)
                {
                    values[i] = ConvertClr(inputs[next++], type, p.Name, fullName);
                }
                else if (p.IsOptional)
                {
                    values[i] = p.DefaultValue is DBNull || p.DefaultValue == Missing.Value ? JsonArgumentConverter.EmptyValue(type) : p.DefaultValue;
                }
                else
                {
                    throw BadRequest($"Missing required argument '{p.Name}' for '{fullName}'.");
                }
            }

            if (next < inputs.Length)
            {
                throw BadRequest($"'{fullName}' takes {next} input arguments but {inputs.Length} were given.");
            }

            return Execute(target, method, fullName, values);
        }

        private (object Target, MethodInfo Method, string FullName) Resolve(string methodPath, int suppliedArgs)
        {
            string[] segments = SplitPath(methodPath);
            if (segments.Length == 0)
            {
                throw BadRequest("Method path is required, e.g. \"FrameObj.GetSection\".");
            }

            string methodName = segments[segments.Length - 1];
            (object target, Type targetType, string objectPath) = ResolveObject(segments.Take(segments.Length - 1).ToArray());
            string fullName = objectPath.Length == 0 ? methodName : objectPath + "." + methodName;

            MethodInfo method = SelectMethod(targetType, methodName, suppliedArgs, fullName);

            if (!RpcPolicy.IsReadOnly(objectPath.Length == 0 ? method.Name : objectPath + "." + method.Name) && !_writesEnabled())
            {
                throw new BridgeException(
                    403,
                    ErrorCodes.WriteDisabled,
                    $"'{fullName}' may modify the model. Enable \"Allow write operations\" in the ETABS Bridge window to call it.");
            }

            return (target, method, fullName);
        }

        private static ApiCallResult Execute(object target, MethodInfo method, string fullName, object?[] values)
        {
            object? returnValue;
            try
            {
                returnValue = method.Invoke(target, values);
            }
            catch (TargetInvocationException ex) when (ex.InnerException != null)
            {
                throw new EtabsApiException(fullName, ex.InnerException.Message, ex.InnerException);
            }

            ParameterInfo[] parameters = method.GetParameters();
            var outputs = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < parameters.Length; i++)
            {
                if (parameters[i].ParameterType.IsByRef)
                {
                    outputs[parameters[i].Name ?? "arg" + i] = values[i];
                }
            }

            return new ApiCallResult
            {
                Method = fullName,
                ReturnValue = method.ReturnType == typeof(void) ? null : returnValue,
                Outputs = outputs,
            };
        }

        private static object? ConvertClr(object? value, Type type, string? name, string fullName)
        {
            if (value == null || type.IsInstanceOfType(value))
            {
                return value;
            }

            try
            {
                if (type.IsEnum)
                {
                    return value is string s ? Enum.Parse(type, s, true) : Enum.ToObject(type, value);
                }

                return System.Convert.ChangeType(value, type, CultureInfo.InvariantCulture);
            }
            catch (Exception ex) when (ex is InvalidCastException || ex is FormatException || ex is OverflowException || ex is ArgumentException)
            {
                throw BadRequest($"Argument '{name}' of '{fullName}': cannot convert {value.GetType().Name} to {ApiReflection.FriendlyName(type)}.");
            }
        }

        private static string[] SplitPath(string? path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return Array.Empty<string>();
            }

            string[] segments = path!.Trim().Split('.');
            if (segments.Any(s => s.Length == 0))
            {
                throw BadRequest($"Invalid API path '{path}'.");
            }

            // Accept an optional "SapModel." prefix, as written in CSI documentation.
            return segments[0].Equals("SapModel", StringComparison.OrdinalIgnoreCase)
                ? segments.Skip(1).ToArray()
                : segments;
        }

        private (object Target, Type Type, string Path) ResolveObject(string[] segments)
        {
            object current = _root;
            Type currentType = _rootType;
            var walked = new List<string>();
            foreach (string segment in segments)
            {
                PropertyInfo? property = ApiReflection.FindProperty(currentType, segment);
                if (property == null)
                {
                    throw new BridgeException(
                        404,
                        ErrorCodes.NotFound,
                        $"'{Join(walked, segment)}' is not an API object. Use /rpc/describe to list available objects.");
                }

                object? next = property.GetValue(current, null);
                if (next == null)
                {
                    throw new EtabsApiException(Join(walked, property.Name), "the API returned null for this object");
                }

                walked.Add(property.Name);
                current = next;
                currentType = property.PropertyType;
            }

            return (current, currentType, string.Join(".", walked));
        }

        private static MethodInfo SelectMethod(Type type, string name, int supplied, string fullName)
        {
            List<MethodInfo> candidates = ApiReflection.GetMethods(type)
                .Where(m => m.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
                .ToList();

            if (candidates.Count == 0)
            {
                throw new BridgeException(404, ErrorCodes.NotFound, $"API method '{fullName}' does not exist.");
            }

            if (candidates.Count == 1)
            {
                return candidates[0];
            }

            // Overloads are rare in the CSI API; pick the single one whose arity accepts the arguments.
            List<MethodInfo> matching = candidates.Where(m => m.GetParameters().Length >= supplied).ToList();
            if (matching.Count == 1)
            {
                return matching[0];
            }

            throw BadRequest($"'{fullName}' is overloaded and the arguments do not identify one overload.");
        }

        private static object?[] BindArguments(ParameterInfo[] parameters, JsonValue? args, string fullName)
        {
            var values = new object?[parameters.Length];
            JsonValue?[] supplied = new JsonValue?[parameters.Length];

            if (args != null && !args.IsNull)
            {
                if (args.Kind == JsonKind.Array)
                {
                    IReadOnlyList<JsonValue> items = args.AsArray();
                    if (items.Count > parameters.Length)
                    {
                        throw BadRequest($"'{fullName}' takes {parameters.Length} arguments but {items.Count} were given.");
                    }

                    for (int i = 0; i < items.Count; i++)
                    {
                        supplied[i] = items[i];
                    }
                }
                else if (args.Kind == JsonKind.Object)
                {
                    foreach (KeyValuePair<string, JsonValue> pair in args.AsObject())
                    {
                        int index = Array.FindIndex(parameters, p => string.Equals(p.Name, pair.Key, StringComparison.OrdinalIgnoreCase));
                        if (index < 0)
                        {
                            string known = string.Join(", ", parameters.Select(p => p.Name));
                            throw BadRequest($"'{fullName}' has no parameter '{pair.Key}'. Parameters: {known}.");
                        }

                        supplied[index] = pair.Value;
                    }
                }
                else
                {
                    throw BadRequest("'args' must be a JSON object (by name), a JSON array (positional) or null.");
                }
            }

            for (int i = 0; i < parameters.Length; i++)
            {
                ParameterInfo p = parameters[i];
                Type type = p.ParameterType.IsByRef ? p.ParameterType.GetElementType()! : p.ParameterType;

                if (supplied[i] != null)
                {
                    try
                    {
                        values[i] = JsonArgumentConverter.Convert(supplied[i]!, type);
                    }
                    catch (Exception ex) when (ex is FormatException || ex is InvalidOperationException || ex is OverflowException || ex is ArgumentException)
                    {
                        throw BadRequest($"Argument '{p.Name}' of '{fullName}': {ex.Message}");
                    }
                }
                else if (p.ParameterType.IsByRef)
                {
                    values[i] = JsonArgumentConverter.EmptyValue(type);
                }
                else if (p.IsOptional)
                {
                    values[i] = p.DefaultValue is DBNull || p.DefaultValue == Missing.Value
                        ? JsonArgumentConverter.EmptyValue(type)
                        : p.DefaultValue;
                }
                else
                {
                    throw BadRequest($"Missing required argument '{p.Name}' ({ApiReflection.FriendlyName(type)}) for '{fullName}'.");
                }
            }

            return values;
        }

        private static string Join(List<string> walked, string next) =>
            walked.Count == 0 ? next : string.Join(".", walked) + "." + next;

        private static BridgeException BadRequest(string message) =>
            new BridgeException(400, ErrorCodes.BadRequest, message);
    }

    /// <summary>Converts JSON argument values to CLR parameter types.</summary>
    internal static class JsonArgumentConverter
    {
        public static object? Convert(JsonValue value, Type type)
        {
            Type? underlying = Nullable.GetUnderlyingType(type);
            if (underlying != null)
            {
                return value.IsNull ? null : Convert(value, underlying);
            }

            if (type == typeof(string))
            {
                return value.IsNull ? null : value.AsString();
            }

            if (type == typeof(bool))
            {
                return value.AsBool();
            }

            if (type == typeof(double))
            {
                return value.AsDouble();
            }

            if (type == typeof(float))
            {
                return (float)value.AsDouble();
            }

            if (type == typeof(int))
            {
                return checked((int)value.AsInt64());
            }

            if (type == typeof(long))
            {
                return value.AsInt64();
            }

            if (type == typeof(short))
            {
                return checked((short)value.AsInt64());
            }

            if (type == typeof(byte))
            {
                return checked((byte)value.AsInt64());
            }

            if (type.IsEnum)
            {
                return ConvertEnum(value, type);
            }

            if (type.IsArray)
            {
                if (value.IsNull)
                {
                    return null;
                }

                Type element = type.GetElementType()!;
                IReadOnlyList<JsonValue> items = value.AsArray();
                Array array = Array.CreateInstance(element, items.Count);
                for (int i = 0; i < items.Count; i++)
                {
                    array.SetValue(Convert(items[i], element), i);
                }

                return array;
            }

            if (type == typeof(object))
            {
                throw new ArgumentException("parameters of type 'object' are not supported over RPC");
            }

            throw new ArgumentException($"parameter type '{ApiReflection.FriendlyName(type)}' is not supported over RPC");
        }

        /// <summary>
        /// Initial value for an omitted ref/out parameter: empty string/array, zero, or enum value 0
        /// (CSI uses 0 for "all/none", e.g. GetNameList(..., MatType = 0) lists every material).
        /// </summary>
        public static object? EmptyValue(Type type)
        {
            if (type == typeof(string))
            {
                return string.Empty;
            }

            if (type.IsArray)
            {
                return Array.CreateInstance(type.GetElementType()!, 0);
            }

            if (type.IsEnum)
            {
                return Enum.ToObject(type, 0);
            }

            return type.IsValueType ? Activator.CreateInstance(type) : null;
        }

        private static object ConvertEnum(JsonValue value, Type type)
        {
            if (value.Kind == JsonKind.String)
            {
                string name = value.AsString();
                string? match = Enum.GetNames(type).FirstOrDefault(n => n.Equals(name, StringComparison.OrdinalIgnoreCase));
                if (match == null)
                {
                    throw new ArgumentException($"'{name}' is not a {type.Name}. Valid: {string.Join(", ", Enum.GetNames(type))}.");
                }

                return Enum.Parse(type, match);
            }

            long number = value.AsInt64();
            object boxed = Enum.ToObject(type, number);
            if (!Enum.IsDefined(type, boxed))
            {
                throw new ArgumentException($"{number.ToString(CultureInfo.InvariantCulture)} is not a defined {type.Name} value.");
            }

            return boxed;
        }
    }
}
