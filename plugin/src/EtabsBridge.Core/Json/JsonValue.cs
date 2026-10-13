using System;
using System.Collections.Generic;
using System.Globalization;

namespace EtabsBridge.Core.Json
{
    /// <summary>The kind of a parsed JSON value.</summary>
    public enum JsonKind
    {
        Null,
        Bool,
        Number,
        String,
        Array,
        Object,
    }

    /// <summary>
    /// Immutable, read-only JSON document node produced by <see cref="JsonParser"/>.
    /// Used for request bodies (RPC arguments) and for reading settings/registry files.
    /// </summary>
    public sealed class JsonValue
    {
        public static readonly JsonValue Null = new JsonValue(JsonKind.Null, null, 0, null, null, null);
        public static readonly JsonValue True = new JsonValue(JsonKind.Bool, true, 0, null, null, null);
        public static readonly JsonValue False = new JsonValue(JsonKind.Bool, false, 0, null, null, null);

        private readonly bool _bool;
        private readonly double _number;
        private readonly string? _text; // string value, or the raw number literal
        private readonly IReadOnlyList<JsonValue>? _items;
        private readonly IReadOnlyDictionary<string, JsonValue>? _properties;

        private JsonValue(
            JsonKind kind,
            bool? boolValue,
            double number,
            string? text,
            IReadOnlyList<JsonValue>? items,
            IReadOnlyDictionary<string, JsonValue>? properties)
        {
            Kind = kind;
            _bool = boolValue ?? false;
            _number = number;
            _text = text;
            _items = items;
            _properties = properties;
        }

        public JsonKind Kind { get; }

        public bool IsNull => Kind == JsonKind.Null;

        internal static JsonValue FromString(string value) =>
            new JsonValue(JsonKind.String, null, 0, value, null, null);

        internal static JsonValue FromNumber(double value, string raw) =>
            new JsonValue(JsonKind.Number, null, value, raw, null, null);

        internal static JsonValue FromArray(IReadOnlyList<JsonValue> items) =>
            new JsonValue(JsonKind.Array, null, 0, null, items, null);

        internal static JsonValue FromObject(IReadOnlyDictionary<string, JsonValue> properties) =>
            new JsonValue(JsonKind.Object, null, 0, null, null, properties);

        public bool AsBool() => Kind == JsonKind.Bool ? _bool : throw WrongKind(JsonKind.Bool);

        public double AsDouble() => Kind == JsonKind.Number ? _number : throw WrongKind(JsonKind.Number);

        /// <summary>Returns the number as a 64-bit integer; throws if it has a fractional part or is out of range.</summary>
        public long AsInt64()
        {
            if (Kind != JsonKind.Number)
            {
                throw WrongKind(JsonKind.Number);
            }

            if (long.TryParse(_text, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out long exact))
            {
                return exact;
            }

            // Accept e.g. 3.0 or 1e3, reject 3.5.
            if (Math.Abs(_number % 1) < double.Epsilon && _number >= long.MinValue && _number <= long.MaxValue)
            {
                return (long)_number;
            }

            throw new FormatException($"JSON number '{_text}' is not an integer.");
        }

        public string AsString() => Kind == JsonKind.String ? _text! : throw WrongKind(JsonKind.String);

        public IReadOnlyList<JsonValue> AsArray() => Kind == JsonKind.Array ? _items! : throw WrongKind(JsonKind.Array);

        public IReadOnlyDictionary<string, JsonValue> AsObject() =>
            Kind == JsonKind.Object ? _properties! : throw WrongKind(JsonKind.Object);

        /// <summary>Gets an object property, or null when this is not an object or the key is absent.</summary>
        public JsonValue? Get(string key)
        {
            if (Kind == JsonKind.Object && _properties!.TryGetValue(key, out JsonValue? value))
            {
                return value;
            }

            return null;
        }

        /// <summary>Convenience accessor for optional string properties.</summary>
        public string? GetString(string key)
        {
            JsonValue? v = Get(key);
            return v != null && v.Kind == JsonKind.String ? v._text : null;
        }

        /// <summary>Convenience accessor for optional integer properties.</summary>
        public long? GetInt64(string key)
        {
            JsonValue? v = Get(key);
            return v != null && v.Kind == JsonKind.Number ? v.AsInt64() : (long?)null;
        }

        /// <summary>Convenience accessor for optional boolean properties.</summary>
        public bool? GetBool(string key)
        {
            JsonValue? v = Get(key);
            return v != null && v.Kind == JsonKind.Bool ? v._bool : (bool?)null;
        }

        public override string ToString() => JsonSerializer.Serialize(this);

        /// <summary>Raw literal of a number, used by the serializer to round-trip without precision loss.</summary>
        internal string RawNumber => _text!;

        private InvalidOperationException WrongKind(JsonKind expected) =>
            new InvalidOperationException($"Expected JSON {expected.ToString().ToLowerInvariant()} but found {Kind.ToString().ToLowerInvariant()}.");
    }
}
