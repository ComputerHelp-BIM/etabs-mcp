using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace EtabsBridge.Core.Rpc
{
    /// <summary>Introspection result for one API object (GET /api/v1/rpc/describe?path=...).</summary>
    public sealed class ApiTypeDescription
    {
        /// <summary>Path of the object, "" for the root (SapModel).</summary>
        public string Path { get; set; } = string.Empty;

        /// <summary>API interface name, e.g. "cFrameObj".</summary>
        public string Type { get; set; } = string.Empty;

        /// <summary>Child API objects reachable from here, e.g. ["FrameObj", "AreaObj", ...].</summary>
        public IReadOnlyList<string> Objects { get; set; } = Array.Empty<string>();

        public IReadOnlyList<ApiMethodDescription> Methods { get; set; } = Array.Empty<ApiMethodDescription>();

        internal static ApiTypeDescription Create(string path, Type type) => new ApiTypeDescription
        {
            Path = path,
            Type = type.Name,
            Objects = ApiReflection.GetObjectProperties(type).Select(p => p.Name).Distinct().OrderBy(n => n, StringComparer.Ordinal).ToList(),
            Methods = ApiReflection.GetMethods(type)
                .OrderBy(m => m.Name, StringComparer.Ordinal)
                .Select(m => ApiMethodDescription.Create(m, path))
                .ToList(),
        };
    }

    public sealed class ApiMethodDescription
    {
        public string Name { get; set; } = string.Empty;

        public string ReturnType { get; set; } = string.Empty;

        /// <summary>True when callable without enabling writes (see <see cref="RpcPolicy"/>).</summary>
        public bool ReadOnly { get; set; }

        public IReadOnlyList<ApiParameterDescription> Parameters { get; set; } = Array.Empty<ApiParameterDescription>();

        internal static ApiMethodDescription Create(MethodInfo method, string objectPath) => new ApiMethodDescription
        {
            Name = method.Name,
            ReturnType = ApiReflection.FriendlyName(method.ReturnType),
            ReadOnly = RpcPolicy.IsReadOnly(objectPath.Length == 0 ? method.Name : objectPath + "." + method.Name),
            Parameters = method.GetParameters().Select(ApiParameterDescription.Create).ToList(),
        };
    }

    public sealed class ApiParameterDescription
    {
        public string Name { get; set; } = string.Empty;

        public string Type { get; set; } = string.Empty;

        /// <summary>"in", "ref" (value in and out) or "out".</summary>
        public string Direction { get; set; } = "in";

        public bool Optional { get; set; }

        /// <summary>Member names when the type is an enum (or enum array); otherwise null.</summary>
        public IReadOnlyList<string>? EnumValues { get; set; }

        internal static ApiParameterDescription Create(ParameterInfo p)
        {
            Type type = p.ParameterType.IsByRef ? p.ParameterType.GetElementType()! : p.ParameterType;
            Type element = type.IsArray ? type.GetElementType()! : type;
            return new ApiParameterDescription
            {
                Name = p.Name ?? string.Empty,
                Type = ApiReflection.FriendlyName(type),
                Direction = !p.ParameterType.IsByRef ? "in" : p.IsOut ? "out" : "ref",
                Optional = p.IsOptional,
                EnumValues = element.IsEnum ? Enum.GetNames(element) : null,
            };
        }
    }
}
