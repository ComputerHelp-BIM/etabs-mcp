using System;
using System.Collections.Generic;
using EtabsBridge.Core.Json;
using Xunit;

namespace EtabsBridge.Core.Tests
{
    public class JsonParserTests
    {
        [Fact]
        public void ParsesNestedDocument()
        {
            JsonValue v = JsonParser.Parse(" {\"a\": [1, -2.5e2, true, null, \"x\\u0041\\n\"], \"b\": {}} ");

            IReadOnlyList<JsonValue> a = v.Get("a")!.AsArray();
            Assert.Equal(1, a[0].AsInt64());
            Assert.Equal(-250.0, a[1].AsDouble());
            Assert.True(a[2].AsBool());
            Assert.True(a[3].IsNull);
            Assert.Equal("xA\n", a[4].AsString());
            Assert.Empty(v.Get("b")!.AsObject());
        }

        [Theory]
        [InlineData("[1,]")]
        [InlineData("{\"a\":1,}")]
        [InlineData("{\"a\":1,\"a\":2}")]
        [InlineData("01")]
        [InlineData("1.")]
        [InlineData("NaN")]
        [InlineData("'x'")]
        [InlineData("\"tab\there\"")]
        [InlineData("{} extra")]
        [InlineData("")]
        [InlineData("[")]
        [InlineData("1e999")]
        public void RejectsInvalidJson(string text)
        {
            Assert.Throws<JsonParseException>(() => JsonParser.Parse(text));
        }

        [Fact]
        public void RejectsExcessiveNesting()
        {
            string deep = new string('[', JsonParser.MaxDepth + 2) + new string(']', JsonParser.MaxDepth + 2);
            Assert.Throws<JsonParseException>(() => JsonParser.Parse(deep));
        }

        [Fact]
        public void AsInt64RejectsFractions()
        {
            Assert.Equal(3, JsonParser.Parse("3.0").AsInt64());
            Assert.Throws<FormatException>(() => JsonParser.Parse("3.5").AsInt64());
        }

        [Fact]
        public void WrongKindThrows()
        {
            Assert.Throws<InvalidOperationException>(() => JsonParser.Parse("\"s\"").AsDouble());
        }
    }

    public class JsonSerializerTests
    {
        private enum Color
        {
            Red,
        }

        private sealed class Sample
        {
            public string ProcessId { get; set; } = "p";

            public IReadOnlyList<double> XLines { get; set; } = new[] { 1.5, double.NaN };

            public Color Tint { get; set; } = Color.Red;

            public string? Missing { get; set; }

            [JsonIgnore]
            public string Secret { get; set; } = "hidden";
        }

        [Fact]
        public void WritesCamelCaseInDeclarationOrder()
        {
            string json = JsonSerializer.Serialize(new Sample());
            Assert.Equal("{\"processId\":\"p\",\"xLines\":[1.5,null],\"tint\":\"Red\",\"missing\":null}", json);
        }

        [Theory]
        [InlineData("ProcessId", "processId")]
        [InlineData("XLines", "xLines")]
        [InlineData("URL", "url")]
        [InlineData("IsMaster", "isMaster")]
        [InlineData("already", "already")]
        [InlineData("X", "x")]
        public void ToCamelCase(string input, string expected)
        {
            Assert.Equal(expected, JsonSerializer.ToCamelCase(input));
        }

        [Fact]
        public void EscapesStrings()
        {
            Assert.Equal("\"a\\\"b\\\\c\\n\\u0001\\u2028\"", JsonSerializer.Serialize("a\"b\\c\n\u0001\u2028"));
        }

        [Fact]
        public void WritesDictionariesAndIntegers()
        {
            var dict = new Dictionary<string, object?> { ["k"] = 42L, ["n"] = null, ["arr"] = new[] { 1, 2 } };
            Assert.Equal("{\"k\":42,\"n\":null,\"arr\":[1,2]}", JsonSerializer.Serialize(dict));
        }

        [Fact]
        public void DoublesRoundTrip()
        {
            double value = 0.1 + 0.2;
            string json = JsonSerializer.Serialize(value);
            Assert.Equal(value, JsonParser.Parse(json).AsDouble());
        }

        [Fact]
        public void ParsedValuesSerializeBack()
        {
            const string text = "{\"a\":[1,2.50,\"x\"],\"b\":true,\"c\":null}";
            Assert.Equal(text, JsonSerializer.Serialize(JsonParser.Parse(text)));
        }
    }
}
