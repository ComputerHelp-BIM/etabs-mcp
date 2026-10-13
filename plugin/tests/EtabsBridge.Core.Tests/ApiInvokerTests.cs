using System.Linq;
using EtabsBridge.Core.Json;
using EtabsBridge.Core.Rpc;
using EtabsBridge.Core.Tests.Fakes.FakeApi;
using Xunit;

namespace EtabsBridge.Core.Tests
{
    public class ApiInvokerTests
    {
        private readonly FakeSapModel _root = new FakeSapModel();
        private bool _writes;

        private ApiInvoker Invoker => new ApiInvoker(_root, typeof(IFakeSapModel), () => _writes);

        private static JsonValue Args(string json) => JsonParser.Parse(json);

        [Fact]
        public void CallsWithNamedArgumentsAndReturnsRefOutputs()
        {
            ApiCallResult r = Invoker.Invoke("FrameObj.GetSection", Args("{\"name\":\"C1\"}"));

            Assert.Equal("FrameObj.GetSection", r.Method);
            Assert.Equal(0, r.ReturnValue);
            Assert.Equal("C500", r.Outputs["PropName"]);
            Assert.Equal(string.Empty, r.Outputs["SAuto"]);
        }

        [Fact]
        public void CallsWithPositionalArguments()
        {
            ApiCallResult r = Invoker.Invoke("FrameObj.GetSection", Args("[\"B9\"]"));
            Assert.Equal("B300", r.Outputs["PropName"]);
        }

        [Fact]
        public void AcceptsSapModelPrefixAndRootMethods()
        {
            ApiCallResult r = Invoker.Invoke("SapModel.GetVersion", null);
            Assert.Equal("22.0.0", r.Outputs["Version"]);
            Assert.Equal(22.0, r.Outputs["MyVersionNumber"]);
        }

        [Fact]
        public void OptionalParametersUseDefaults()
        {
            Assert.Equal(@"C:\M\Sample.EDB", Invoker.Invoke("GetModelFilename", null).ReturnValue);
            Assert.Equal("Sample.EDB", Invoker.Invoke("GetModelFilename", Args("{\"IncludePath\":false}")).ReturnValue);
        }

        [Fact]
        public void ReturnsArraysAndEnumsFromRefParameters()
        {
            ApiCallResult names = Invoker.Invoke("FrameObj.GetNameList", null);
            Assert.Equal(new[] { "C1", "B1" }, (string[])names.Outputs["MyName"]!);

            ApiCallResult orient = Invoker.Invoke("FrameObj.GetDesignOrientation", Args("{\"Name\":\"C1\"}"));
            Assert.Equal(eOrientation.Column, orient.Outputs["DesignOrientation"]);
        }

        [Fact]
        public void ConvertsEnumArgumentsByNameOrNumber()
        {
            Assert.Equal(7, Invoker.Invoke("FrameObj.CountByType", Args("{\"Type\":\"column\"}")).ReturnValue);
            Assert.Equal(3, Invoker.Invoke("FrameObj.CountByType", Args("{\"Type\":2}")).ReturnValue);
            AssertBridgeError(400, ErrorCodes.BadRequest, () => Invoker.Invoke("FrameObj.CountByType", Args("{\"Type\":\"Girder\"}")));
            AssertBridgeError(400, ErrorCodes.BadRequest, () => Invoker.Invoke("FrameObj.CountByType", Args("{\"Type\":99}")));
        }

        [Fact]
        public void BlocksWritesUnlessEnabled()
        {
            AssertBridgeError(403, ErrorCodes.WriteDisabled, () => Invoker.Invoke("FrameObj.SetSection", Args("[\"C1\",\"C600\"]")));
            Assert.Null(_root.Frames.LastSetSection);

            _writes = true;
            Invoker.Invoke("FrameObj.SetSection", Args("[\"C1\",\"C600\"]"));
            Assert.Equal("C1=C600", _root.Frames.LastSetSection);
        }

        [Fact]
        public void ConvertsArrayArguments()
        {
            _writes = true;
            Invoker.Invoke("FrameObj.SetPoints", Args("{\"Name\":\"F\",\"Coordinates\":[1,2.5]}"));
            Assert.Equal(new[] { 1.0, 2.5 }, _root.Frames.LastPoints);
        }

        [Fact]
        public void ValidatesArguments()
        {
            AssertBridgeError(400, ErrorCodes.BadRequest, () => Invoker.Invoke("FrameObj.GetSection", null)); // Name missing
            AssertBridgeError(400, ErrorCodes.BadRequest, () => Invoker.Invoke("FrameObj.GetSection", Args("{\"Nmae\":\"C1\"}")));
            AssertBridgeError(400, ErrorCodes.BadRequest, () => Invoker.Invoke("FrameObj.GetSection", Args("[\"a\",\"b\",\"c\",\"d\"]")));
            AssertBridgeError(400, ErrorCodes.BadRequest, () => Invoker.Invoke("FrameObj.GetSection", Args("{\"Name\":5}")));
            AssertBridgeError(400, ErrorCodes.BadRequest, () => Invoker.Invoke("FrameObj.GetSection", Args("\"C1\"")));
            AssertBridgeError(400, ErrorCodes.BadRequest, () => Invoker.Invoke("", null));
            AssertBridgeError(400, ErrorCodes.BadRequest, () => Invoker.Invoke("FrameObj..GetSection", null));
        }

        [Fact]
        public void UnknownMembersAre404()
        {
            AssertBridgeError(404, ErrorCodes.NotFound, () => Invoker.Invoke("FrameObj.GetNope", null));
            AssertBridgeError(404, ErrorCodes.NotFound, () => Invoker.Invoke("NopeObj.GetSection", null));
            // Methods of System.Object are not reachable.
            AssertBridgeError(404, ErrorCodes.NotFound, () => Invoker.Invoke("FrameObj.GetType", null));
        }

        [Fact]
        public void ApiExceptionsAreWrapped()
        {
            EtabsApiException ex = Assert.Throws<EtabsApiException>(() => Invoker.Invoke("FrameObj.GetThrows", Args("[\"x\"]")));
            Assert.Equal("FrameObj.GetThrows", ex.ApiCall);
            Assert.Contains("boom x", ex.Message);

            Assert.Throws<EtabsApiException>(() => Invoker.Invoke("Broken.GetNothing", null));
        }

        [Fact]
        public void DescribesRootAndChildObjects()
        {
            ApiTypeDescription root = Invoker.Describe(null);
            Assert.Equal(string.Empty, root.Path);
            Assert.Contains("FrameObj", root.Objects);
            Assert.Contains(root.Methods, m => m.Name == "GetVersion" && m.ReadOnly);

            ApiTypeDescription frames = Invoker.Describe("SapModel.FrameObj");
            Assert.Equal("FrameObj", frames.Path);
            Assert.Equal("IFakeFrameObj", frames.Type);

            ApiMethodDescription getSection = frames.Methods.Single(m => m.Name == "GetSection");
            Assert.Equal("int", getSection.ReturnType);
            Assert.Equal(new[] { "in", "ref", "ref" }, getSection.Parameters.Select(p => p.Direction));
            Assert.Equal("string", getSection.Parameters[1].Type);

            ApiMethodDescription setSection = frames.Methods.Single(m => m.Name == "SetSection");
            Assert.False(setSection.ReadOnly);

            ApiParameterDescription enumParam = frames.Methods.Single(m => m.Name == "CountByType").Parameters[0];
            Assert.Equal(new[] { "Column", "Beam" }, enumParam.EnumValues);
        }

        [Theory]
        [InlineData("GetAllFrames", true)]
        [InlineData("Count", true)]
        [InlineData("SetSection", false)]
        [InlineData("Delete", false)]
        [InlineData("getLower", false)]
        [InlineData("Results.Setup.SetCaseSelectedForOutput", true)]
        [InlineData("results.setup.DeselectAllCasesAndCombosForOutput", true)]
        [InlineData("FrameObj.SetSection", false)]
        [InlineData("FrameObj.GetSection", true)]
        [InlineData("Results.BaseReact", true)]
        [InlineData("ResultsX.SetThing", false)]
        public void ReadOnlyPolicy(string method, bool expected)
        {
            Assert.Equal(expected, RpcPolicy.IsReadOnly(method));
        }

        private static void AssertBridgeError(int status, string code, System.Action action)
        {
            BridgeException ex = Assert.Throws<BridgeException>(action);
            Assert.Equal(status, ex.Status);
            Assert.Equal(code, ex.Code);
        }
    }
}
