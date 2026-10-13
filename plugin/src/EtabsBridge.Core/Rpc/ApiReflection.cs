using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;

namespace EtabsBridge.Core.Rpc
{
    /// <summary>Decides which API methods are safe to call without enabling writes.</summary>
    public static class RpcPolicy
    {
        /// <summary>
        /// Method name prefixes treated as read-only. The CSI API names every query
        /// Get*/Count*; anything else (Set*, Add*, Delete*, Run*, Save*, ...) is a write.
        /// This is a naming convention, not a guarantee, which is why writes are an explicit opt-in.
        /// </summary>
        public static readonly IReadOnlyList<string> ReadOnlyPrefixes = new[] { "Get", "Count" };

        public static bool IsReadOnly(string methodName) =>
            ReadOnlyPrefixes.Any(p => methodName.StartsWith(p, StringComparison.Ordinal));
    }

    /// <summary>Reflection helpers that see members inherited through interface inheritance.</summary>
    internal static class ApiReflection
    {
        public static IEnumerable<Type> SelfAndInterfaces(Type type) =>
            new[] { type }.Concat(type.IsInterface ? type.GetInterfaces() : Array.Empty<Type>());

        public static PropertyInfo? FindProperty(Type type, string name) =>
            SelfAndInterfaces(type)
                .SelectMany(t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
                .FirstOrDefault(p => p.Name.Equals(name, StringComparison.OrdinalIgnoreCase)
                                     && p.CanRead
                                     && p.GetIndexParameters().Length == 0
                                     && IsApiObjectType(p.PropertyType));

        public static IEnumerable<PropertyInfo> GetObjectProperties(Type type) =>
            SelfAndInterfaces(type)
                .SelectMany(t => t.GetProperties(BindingFlags.Public | BindingFlags.Instance))
                .Where(p => p.CanRead && p.GetIndexParameters().Length == 0 && IsApiObjectType(p.PropertyType));

        public static IEnumerable<MethodInfo> GetMethods(Type type) =>
            SelfAndInterfaces(type)
                .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Instance))
                .Where(m => !m.IsSpecialName && !m.IsGenericMethodDefinition && m.DeclaringType != typeof(object));

        /// <summary>API sub-objects (cFrameObj, ...) are interfaces or classes, never primitives/strings/arrays.</summary>
        private static bool IsApiObjectType(Type t) =>
            !t.IsPrimitive && !t.IsEnum && !t.IsArray && !t.IsValueType && t != typeof(string) && t != typeof(object);

        /// <summary>C#-style display name: "double", "string[]", "eUnits".</summary>
        public static string FriendlyName(Type type)
        {
            if (type.IsByRef)
            {
                return FriendlyName(type.GetElementType()!);
            }

            if (type.IsArray)
            {
                return FriendlyName(type.GetElementType()!) + "[]";
            }

            if (type == typeof(void)) return "void";
            if (type == typeof(string)) return "string";
            if (type == typeof(double)) return "double";
            if (type == typeof(float)) return "float";
            if (type == typeof(int)) return "int";
            if (type == typeof(long)) return "long";
            if (type == typeof(short)) return "short";
            if (type == typeof(byte)) return "byte";
            if (type == typeof(bool)) return "bool";
            if (type == typeof(object)) return "object";

            Type? nullable = Nullable.GetUnderlyingType(type);
            return nullable != null ? FriendlyName(nullable) + "?" : type.Name;
        }
    }
}
