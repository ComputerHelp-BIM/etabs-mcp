using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace EtabsBridge.Core.Json
{
    /// <summary>Thrown when input is not valid JSON.</summary>
    public sealed class JsonParseException : FormatException
    {
        public JsonParseException(string message, int position)
            : base($"{message} (at position {position})")
        {
            Position = position;
        }

        public int Position { get; }
    }

    /// <summary>
    /// Strict RFC 8259 JSON parser producing <see cref="JsonValue"/> trees.
    /// Rejects trailing commas, comments, NaN/Infinity, duplicate keys and trailing content.
    /// </summary>
    public static class JsonParser
    {
        /// <summary>Maximum nesting depth; guards against stack exhaustion from hostile input.</summary>
        public const int MaxDepth = 64;

        public static JsonValue Parse(string text)
        {
            if (text == null)
            {
                throw new ArgumentNullException(nameof(text));
            }

            var reader = new Reader(text);
            reader.SkipWhitespace();
            JsonValue value = reader.ReadValue(0);
            reader.SkipWhitespace();
            if (!reader.AtEnd)
            {
                throw reader.Error("Unexpected content after JSON value");
            }

            return value;
        }

        private sealed class Reader
        {
            private readonly string _s;
            private int _pos;

            public Reader(string s)
            {
                _s = s;
            }

            public bool AtEnd => _pos >= _s.Length;

            public JsonParseException Error(string message) => new JsonParseException(message, _pos);

            public void SkipWhitespace()
            {
                while (_pos < _s.Length)
                {
                    char c = _s[_pos];
                    if (c == ' ' || c == '\t' || c == '\n' || c == '\r')
                    {
                        _pos++;
                    }
                    else
                    {
                        break;
                    }
                }
            }

            public JsonValue ReadValue(int depth)
            {
                if (depth > MaxDepth)
                {
                    throw Error($"JSON nesting deeper than {MaxDepth}");
                }

                if (AtEnd)
                {
                    throw Error("Unexpected end of input");
                }

                char c = _s[_pos];
                switch (c)
                {
                    case '{':
                        return ReadObject(depth);
                    case '[':
                        return ReadArray(depth);
                    case '"':
                        return JsonValue.FromString(ReadString());
                    case 't':
                        ExpectLiteral("true");
                        return JsonValue.True;
                    case 'f':
                        ExpectLiteral("false");
                        return JsonValue.False;
                    case 'n':
                        ExpectLiteral("null");
                        return JsonValue.Null;
                    default:
                        if (c == '-' || (c >= '0' && c <= '9'))
                        {
                            return ReadNumber();
                        }

                        throw Error($"Unexpected character '{c}'");
                }
            }

            private JsonValue ReadObject(int depth)
            {
                _pos++; // {
                var props = new Dictionary<string, JsonValue>(StringComparer.Ordinal);
                SkipWhitespace();
                if (Peek() == '}')
                {
                    _pos++;
                    return JsonValue.FromObject(props);
                }

                while (true)
                {
                    SkipWhitespace();
                    if (Peek() != '"')
                    {
                        throw Error("Expected property name");
                    }

                    string key = ReadString();
                    if (props.ContainsKey(key))
                    {
                        throw Error($"Duplicate property '{key}'");
                    }

                    SkipWhitespace();
                    Expect(':');
                    SkipWhitespace();
                    props[key] = ReadValue(depth + 1);
                    SkipWhitespace();
                    char c = Next();
                    if (c == '}')
                    {
                        return JsonValue.FromObject(props);
                    }

                    if (c != ',')
                    {
                        _pos--;
                        throw Error("Expected ',' or '}'");
                    }
                }
            }

            private JsonValue ReadArray(int depth)
            {
                _pos++; // [
                var items = new List<JsonValue>();
                SkipWhitespace();
                if (Peek() == ']')
                {
                    _pos++;
                    return JsonValue.FromArray(items);
                }

                while (true)
                {
                    SkipWhitespace();
                    items.Add(ReadValue(depth + 1));
                    SkipWhitespace();
                    char c = Next();
                    if (c == ']')
                    {
                        return JsonValue.FromArray(items);
                    }

                    if (c != ',')
                    {
                        _pos--;
                        throw Error("Expected ',' or ']'");
                    }
                }
            }

            private string ReadString()
            {
                Expect('"');
                var sb = new StringBuilder();
                while (true)
                {
                    if (AtEnd)
                    {
                        throw Error("Unterminated string");
                    }

                    char c = _s[_pos++];
                    if (c == '"')
                    {
                        return sb.ToString();
                    }

                    if (c < 0x20)
                    {
                        _pos--;
                        throw Error("Unescaped control character in string");
                    }

                    if (c != '\\')
                    {
                        sb.Append(c);
                        continue;
                    }

                    char e = Next();
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u': sb.Append(ReadHex4()); break;
                        default:
                            _pos--;
                            throw Error($"Invalid escape '\\{e}'");
                    }
                }
            }

            private char ReadHex4()
            {
                if (_pos + 4 > _s.Length)
                {
                    throw Error("Truncated \\u escape");
                }

                string hex = _s.Substring(_pos, 4);
                if (!ushort.TryParse(hex, NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out ushort code))
                {
                    throw Error($"Invalid \\u escape '{hex}'");
                }

                _pos += 4;
                return (char)code;
            }

            private JsonValue ReadNumber()
            {
                int start = _pos;
                if (Peek() == '-')
                {
                    _pos++;
                }

                if (Peek() == '0')
                {
                    _pos++;
                }
                else if (IsDigit(Peek()))
                {
                    while (IsDigit(Peek()))
                    {
                        _pos++;
                    }
                }
                else
                {
                    throw Error("Invalid number");
                }

                if (Peek() == '.')
                {
                    _pos++;
                    if (!IsDigit(Peek()))
                    {
                        throw Error("Expected digit after decimal point");
                    }

                    while (IsDigit(Peek()))
                    {
                        _pos++;
                    }
                }

                if (Peek() == 'e' || Peek() == 'E')
                {
                    _pos++;
                    if (Peek() == '+' || Peek() == '-')
                    {
                        _pos++;
                    }

                    if (!IsDigit(Peek()))
                    {
                        throw Error("Expected digit in exponent");
                    }

                    while (IsDigit(Peek()))
                    {
                        _pos++;
                    }
                }

                string raw = _s.Substring(start, _pos - start);
                double value = double.Parse(raw, NumberStyles.Float, CultureInfo.InvariantCulture);
                if (double.IsInfinity(value))
                {
                    throw new JsonParseException("Number out of range", start);
                }

                return JsonValue.FromNumber(value, raw);
            }

            private void ExpectLiteral(string literal)
            {
                if (string.CompareOrdinal(_s, _pos, literal, 0, literal.Length) != 0)
                {
                    throw Error($"Expected '{literal}'");
                }

                _pos += literal.Length;
            }

            private void Expect(char c)
            {
                if (Peek() != c)
                {
                    throw Error($"Expected '{c}'");
                }

                _pos++;
            }

            private char Peek() => _pos < _s.Length ? _s[_pos] : '\0';

            private char Next()
            {
                if (AtEnd)
                {
                    throw Error("Unexpected end of input");
                }

                return _s[_pos++];
            }

            private static bool IsDigit(char c) => c >= '0' && c <= '9';
        }
    }
}
