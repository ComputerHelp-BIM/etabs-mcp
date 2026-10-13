using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;

namespace EtabsBridge.Core.Json
{
    /// <summary>Excludes a property from JSON output.</summary>
    [AttributeUsage(AttributeTargets.Property)]
    public sealed class JsonIgnoreAttribute : Attribute
    {
    }

    /// <summary>
    /// Minimal reflection-based JSON writer for the bridge's DTOs and API results.
    /// <list type="bullet">
    /// <item>Public instance properties, camelCase names, declaration order.</item>
    /// <item>Enums as their name; non-finite doubles as null; DateTime(Offset) as ISO 8601.</item>
    /// <item>IDictionary with string keys as objects (keys written verbatim); IEnumerable as arrays.</item>
    /// </list>
    /// Compact output only: it is consumed by programs, not people.
    /// </summary>
    public static class JsonSerializer
    {
        private static readonly ConcurrentDictionary<Type, PropertyAccessor[]> PropertyCache =
            new ConcurrentDictionary<Type, PropertyAccessor[]>();

        public static string Serialize(object? value)
        {
            using (var writer = new StringWriter(CultureInfo.InvariantCulture))
            {
                Serialize(value, writer);
                return writer.ToString();
            }
        }

        public static void Serialize(object? value, TextWriter writer)
        {
            if (writer == null)
            {
                throw new ArgumentNullException(nameof(writer));
            }

            WriteValue(writer, value, 0);
        }

        /// <summary>Converts "PropertyName" to "propertyName" (and "XLines" to "xLines").</summary>
        public static string ToCamelCase(string name)
        {
            if (string.IsNullOrEmpty(name) || char.IsLower(name[0]))
            {
                return name;
            }

            char[] chars = name.ToCharArray();
            for (int i = 0; i < chars.Length; i++)
            {
                // Lower-case a leading run of capitals, but keep the capital that starts the next word: "XLines" -> "xLines".
                bool nextIsLower = i + 1 < chars.Length && char.IsLower(chars[i + 1]);
                if (i > 0 && nextIsLower)
                {
                    break;
                }

                if (!char.IsUpper(chars[i]))
                {
                    break;
                }

                chars[i] = char.ToLowerInvariant(chars[i]);
            }

            return new string(chars);
        }

        private static void WriteValue(TextWriter w, object? value, int depth)
        {
            if (depth > JsonParser.MaxDepth)
            {
                throw new InvalidOperationException("Object graph too deep (cycle?) for JSON serialization.");
            }

            switch (value)
            {
                case null:
                    w.Write("null");
                    return;
                case JsonValue json:
                    WriteJsonValue(w, json, depth);
                    return;
                case string s:
                    WriteString(w, s);
                    return;
                case bool b:
                    w.Write(b ? "true" : "false");
                    return;
                case char ch:
                    WriteString(w, ch.ToString());
                    return;
                case double d:
                    WriteDouble(w, d);
                    return;
                case float f:
                    WriteDouble(w, f);
                    return;
                case decimal m:
                    w.Write(m.ToString(CultureInfo.InvariantCulture));
                    return;
                case DateTime dt:
                    WriteString(w, dt.ToString("o", CultureInfo.InvariantCulture));
                    return;
                case DateTimeOffset dto:
                    WriteString(w, dto.ToString("o", CultureInfo.InvariantCulture));
                    return;
                case Enum e:
                    WriteString(w, e.ToString());
                    return;
                case IFormattable f when IsInteger(value.GetType()):
                    w.Write(f.ToString(null, CultureInfo.InvariantCulture));
                    return;
                case IDictionary dict:
                    WriteDictionary(w, dict, depth);
                    return;
                case IEnumerable seq:
                    WriteArray(w, seq, depth);
                    return;
                default:
                    WriteObject(w, value, depth);
                    return;
            }
        }

        private static void WriteJsonValue(TextWriter w, JsonValue json, int depth)
        {
            switch (json.Kind)
            {
                case JsonKind.Null: w.Write("null"); break;
                case JsonKind.Bool: w.Write(json.AsBool() ? "true" : "false"); break;
                case JsonKind.Number: w.Write(json.RawNumber); break;
                case JsonKind.String: WriteString(w, json.AsString()); break;
                case JsonKind.Array: WriteArray(w, json.AsArray(), depth); break;
                case JsonKind.Object:
                    WriteDictionary(w, json.AsObject().ToDictionary(p => p.Key, p => (object)p.Value), depth);
                    break;
            }
        }

        private static void WriteDouble(TextWriter w, double d)
        {
            if (double.IsNaN(d) || double.IsInfinity(d))
            {
                w.Write("null"); // JSON has no NaN/Infinity.
                return;
            }

            w.Write(d.ToString("R", CultureInfo.InvariantCulture));
        }

        private static void WriteArray(TextWriter w, IEnumerable seq, int depth)
        {
            w.Write('[');
            bool first = true;
            foreach (object? item in seq)
            {
                if (!first)
                {
                    w.Write(',');
                }

                first = false;
                WriteValue(w, item, depth + 1);
            }

            w.Write(']');
        }

        private static void WriteDictionary(TextWriter w, IDictionary dict, int depth)
        {
            w.Write('{');
            bool first = true;
            foreach (DictionaryEntry entry in dict)
            {
                if (!first)
                {
                    w.Write(',');
                }

                first = false;
                WriteString(w, Convert.ToString(entry.Key, CultureInfo.InvariantCulture) ?? string.Empty);
                w.Write(':');
                WriteValue(w, entry.Value, depth + 1);
            }

            w.Write('}');
        }

        private static void WriteObject(TextWriter w, object value, int depth)
        {
            PropertyAccessor[] props = PropertyCache.GetOrAdd(value.GetType(), BuildAccessors);
            w.Write('{');
            for (int i = 0; i < props.Length; i++)
            {
                if (i > 0)
                {
                    w.Write(',');
                }

                WriteString(w, props[i].JsonName);
                w.Write(':');
                WriteValue(w, props[i].Property.GetValue(value, null), depth + 1);
            }

            w.Write('}');
        }

        private static PropertyAccessor[] BuildAccessors(Type type) =>
            type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Where(p => p.CanRead && p.GetIndexParameters().Length == 0 && p.GetCustomAttribute<JsonIgnoreAttribute>() == null)
                .OrderBy(p => p.MetadataToken) // declaration order
                .Select(p => new PropertyAccessor(p, ToCamelCase(p.Name)))
                .ToArray();

        private static bool IsInteger(Type t) =>
            t == typeof(int) || t == typeof(long) || t == typeof(short) || t == typeof(byte) ||
            t == typeof(uint) || t == typeof(ulong) || t == typeof(ushort) || t == typeof(sbyte);

        internal static void WriteString(TextWriter w, string s)
        {
            w.Write('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': w.Write("\\\""); break;
                    case '\\': w.Write("\\\\"); break;
                    case '\n': w.Write("\\n"); break;
                    case '\r': w.Write("\\r"); break;
                    case '\t': w.Write("\\t"); break;
                    case '\b': w.Write("\\b"); break;
                    case '\f': w.Write("\\f"); break;
                    default:
                        if (c < 0x20 || c == (char)0x2028 || c == (char)0x2029)
                        {
                            w.Write("\\u");
                            w.Write(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            w.Write(c);
                        }

                        break;
                }
            }

            w.Write('"');
        }

        private sealed class PropertyAccessor
        {
            public PropertyAccessor(PropertyInfo property, string jsonName)
            {
                Property = property;
                JsonName = jsonName;
            }

            public PropertyInfo Property { get; }

            public string JsonName { get; }
        }
    }
}
